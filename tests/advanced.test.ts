import chaiAsPromised               from 'chai-as-promised';
import chai, {expect}               from 'chai';
import getStream                    from 'get-stream';
import {PassThrough}                from 'stream';

import {Cli, CommandClass, Command, CliOptions} from '../sources/advanced';

chai.use(chaiAsPromised);

const log = <T extends Command>(command: T, properties: (keyof T)[] = []) => {
    command.context.stdout.write(`Running ${command.constructor.name}\n`);

    for (const property of properties) {
        command.context.stdout.write(`${JSON.stringify(command[property])}\n`);
    }
};

const runCli = async (cli: Cli | (() => CommandClass[]), args: string[]) => {
    let finalCli;

    if (typeof cli === `function`) {
        finalCli = new Cli();

        for (const command of cli()) {
            finalCli.register(command);
        }
    } else {
        finalCli = cli;
    }

    const stream = new PassThrough();
    const promise = getStream(stream);

    const exitCode = await finalCli.run(args, {
        stdin: process.stdin,
        stdout: stream,
        stderr: stream,
    });

    stream.end();

    const output = await promise;

    if (exitCode !== 0)
        throw new Error(output);

    return output;
};

const prefix = `\u001b[1m$ \u001b[22m`;

describe(`Advanced`, () => {
    describe(`Builtin Entries`, () => {
        describe(`help`, () => {
            it(`should have a path`, async () => {
                const cli = new Cli();

                class CommandA extends Command {
                    async execute() {}
                }
                cli.register(CommandA);

                class CommandB extends Command {
                    @Command.Path(`b`)
                    async execute() {}
                }
                cli.register(CommandB);

                class CommandB1 extends Command {
                    @Command.Path(`b`, `one`)
                    async execute() {}
                }
                cli.register(CommandB1);

                class CommandB2 extends Command {
                    @Command.Path(`b`, `two`)
                    async execute() {}
                }
                cli.register(CommandB2);

                expect(cli.process([`-h`]).path).to.deep.equal([]);

                cli.register(Command.Entries.Help);
                expect(cli.process([`-h`]).path).to.deep.equal([`-h`]);

                expect(cli.process([`b`, `--help`]).path).to.deep.equal([`b`]);
                expect(cli.process([`b`, `one`, `--help`]).path).to.deep.equal([`b`, `one`]);
            });

            it(`should display the usage`, async () => {
                const cli = new Cli()
                cli.register(Command.Entries.Help);

                expect(await runCli(cli, [`-h`])).to.equal(cli.usage(null));
                expect(await runCli(cli, [`--help`])).to.equal(cli.usage(null));
            })
        });

        describe(`version`, () => {
            it(`should display the version of the binary`, async () => {
                const cli = new Cli({binaryVersion: `2.3.4`})
                cli.register(Command.Entries.Version);

                expect(await runCli(cli, [`-v`])).to.equal(`2.3.4\n`);
                expect(await runCli(cli, [`--version`])).to.equal(`2.3.4\n`);

            });

            it(`should display "<unknown>" when no version is specified`, async () => {
                const cli = new Cli()
                cli.register(Command.Entries.Version);

                expect(await runCli(cli, [`-v`])).to.equal(`<unknown>\n`);
                expect(await runCli(cli, [`--version`])).to.equal(`<unknown>\n`);

            });
        });
    });

    it(`should print the general help listing when using --help on the raw command`, async () => {
        const output = await runCli(() => {
            class CommandHelp extends Command {
                @Command.Path(`--help`)
                @Command.Path(`-h`)
                async execute() {
                    this.context.stdout.write(this.cli.usage(null));
                }
            }

            class CommandA extends Command {
                async execute() {log(this)}
            }

            return [
                CommandHelp,
                CommandA,
            ];
        }, [
            `--help`,
        ]);

        expect(output).to.include(`${prefix}... <command>\n`);
    });

    it(`should print the help message when using --help`, async () => {
        const output = await runCli(() => {
            class CommandA extends Command {
                @Command.Boolean(`--foo`)
                foo: boolean = false;

                async execute() {log(this)}
            }

            return [
                CommandA,
            ];
        }, [
            `--help`,
        ]);

        expect(output).to.equal(`${prefix}... [--foo]\n`);
    });

    it(`shouldn't detect --help past the -- separator`, async () => {
        const output = await runCli(() => {
            class CommandA extends Command {
                @Command.String()
                arg!: string;

                async execute() {log(this)}
            }
            return [
                CommandA,
            ];
        }, [
            `--`,
            `--help`,
        ]);

        expect(output).to.equal(`Running CommandA\n`);
    });

    it(`shouldn't detect --help on proxies`, async () => {
        const output = await runCli(() => {
            class CommandA extends Command {
                @Command.Proxy()
                args: string[] = [];

                async execute() {log(this, [`args`])}
            }
            return [
                CommandA,
            ];
        }, [
            `--help`,
        ]);

        expect(output).to.equal(`Running CommandA\n["--help"]\n`);
    });

    it(`should replace binary name in command help`, async () => {
        const output = await runCli(() => {
            class CommandA extends Command {
                @Command.Path(`add`)
                async execute() {log(this)}
            }
            return [
                CommandA,
            ];
        }, [
            `add`,
            `--help`,
        ]);

        expect(output).to.equal(`${prefix}... add\n`);
        expect(output).not.to.equal(`$0`);
    });

    it(`should expose Cli options on the MiniCli`, async () => {
        const binaryInfo: CliOptions = {
            binaryLabel: `My CLI`,
            binaryName: `my-cli`,
            binaryVersion: `1.0.0`,
            enableColors: false,
        };

        const cli = new Cli(binaryInfo);

        cli.register(
            class CommandA extends Command {
                async execute() {
                    this.context.stdout.write(JSON.stringify(this.cli));
                }
            }
        );

        const output = await runCli(cli, []);

        expect(JSON.parse(output)).to.contain(binaryInfo);
    });

    it(`should allow calling a command from another`, async () => {
        const output = await runCli(() => {
            class CommandA extends Command {
                @Command.Path(`foo`)
                async execute() {
                    log(this);
                    this.cli.run([`bar`]);
                }
            }

            class CommandB extends Command {
                @Command.Path(`bar`)
                async execute() {
                    log(this);
                }
            }

            return [
                CommandA,
                CommandB,
            ];
        }, [`foo`]);

        expect(output).to.equal(`Running CommandA\nRunning CommandB\n`);
    });

    it(`should support inheritance`, async () => {
        const output = await runCli(() => {
            abstract class CommandA extends Command {
                @Command.String(`--foo`)
                foo!: string;

                abstract execute(): Promise<number | void>;
            }

            class CommandB extends CommandA {
                async execute() {
                    log(this, [`foo`]);
                }
            }

            return [
                CommandB,
            ];
        }, [`--foo`, `hello`]);

        expect(output).to.equal(`Running CommandB\n"hello"\n`);
    });

    it(`derives positional argument names from the property name`, async () => {
        class CommandA extends Command {
            @Command.String()
            workspaceName!: string;

            @Command.String({required: false})
            extra!: string;

            @Command.String()
            scriptName!: string;

            @Command.Path(`workspace`)
            async execute() {
                throw new Error('not implemented, just testing usage()')
            }
        }

        const cli = Cli.from([CommandA])

        expect(cli.usage(CommandA)).to.equal(`\u001b[1m$ \u001b[22m... workspace <workspaceName> [extra] <scriptName>\n`);
    });

    it(`derives rest argument names from the property name`, async () => {
        class CommandA extends Command {
            @Command.Rest({required: 2})
            workspaceNames!: string;

            @Command.Path(`clean`)
            async execute() {
                throw new Error('not implemented, just testing usage()')
            }
        }

        const cli = Cli.from([CommandA])

        expect(cli.usage(CommandA)).to.equal(`\u001b[1m$ \u001b[22m... clean <workspaceNames> <workspaceNames> ...\n`);
    });

    it(`supports strings that act like booleans if not bound to a value`, async () => {
        class CommandA extends Command {
            @Command.String(`--break`, { tolerateBoolean: true })
            enableDebugger: boolean | string = false;

            async execute() {
                log(this, [`enableDebugger`]);
            }
        }

        class InvertedCommandA extends Command {
            @Command.String(`--break`, { tolerateBoolean: true })
            enableDebugger: boolean | string = true;

            async execute() {
                log(this, [`enableDebugger`]);
            }
        }

        let cli = Cli.from([CommandA])

        expect(cli.process([])).to.contain({enableDebugger: false});
        expect(cli.process([`--break`])).to.contain({enableDebugger: true});
        expect(cli.process([`--no-break`])).to.contain({enableDebugger: false});
        expect(cli.process([`--break=1234`])).to.contain({enableDebugger: "1234"});
        expect(() => { cli.process([`--break`, `1234`])}).to.throw(Error);
        expect(() => { cli.process([`--no-break=1234`])}).to.throw(Error);

        cli = Cli.from([InvertedCommandA])

        expect(cli.process([])).to.contain({enableDebugger: true});
        expect(cli.process([`--break`])).to.contain({enableDebugger: true});
        expect(cli.process([`--no-break`])).to.contain({enableDebugger: false});
    });

    it(`shouldn't crash when throwing non-error exceptions`, async () => {
        await expect(runCli(() => {
            class CommandA extends Command {
                async execute() {throw 42}
            }

            return [
                CommandA,
            ];
        }, [])).to.be.rejectedWith(`non-error rejection`);
    });

    it(`shouldn't crash when throwing non-error exceptions`, async () => {
        class CommandA extends Command {
            @Command.String({name: 'prettyName'})
            thisNameIsntUsed!: string;

            async execute() {throw 42}
        }

        const cli = Cli.from([CommandA])
        const usage = cli.usage(CommandA);

        expect(usage).not.to.contain('thisNameIsntUsed');
        expect(usage).to.contain('prettyName');

        const command = cli.process(['foo']);

        expect((command as CommandA).thisNameIsntUsed).to.eq('foo');
    });

    it(`should use default error handler when no custom logic is registered`, async () => {
        await expect(runCli(() => {
            class CommandA extends Command {
                async execute() {throw new Error(`default error`)}
            }

            return [
                CommandA,
            ];
        }, [])).to.be.rejectedWith(`default error`);
    });

    it(`should allow to override error handler`, async () => {
        let catchCalled = false;

        await expect(runCli(() => {
            class CommandA extends Command {
                async execute() {throw new Error(`command failed`)}
                async catch(error: Error) {
                    catchCalled = true;
                    throw error;
                }
            }

            return [
                CommandA,
            ];
        }, [])).to.be.rejectedWith(`command failed`);

        expect(catchCalled).to.be.true;
    });

    it(`should not throw if custom error handler swallows error`, async () => {
        await expect(runCli(() => {
            class CommandA extends Command {
                async execute() {throw new Error(`command failed`)}
                async catch() {}
            }

            return [
                CommandA,
            ];
        }, [])).to.eventually.equal(``);
    });

    it(`should allow to rethrow error to parent class(es)`, async () => {
        const calls = {
            base: false,
            commandA: false,
            commandB: false
        };

        await expect(runCli(() => {
            class Base extends Command {
                async execute() {}
                async catch(error: Error) {
                    calls.base = true;
                    return super.catch(error);
                }
            }

            class CommandA extends Base {
                async execute() {}
                async catch(error: Error) {
                    calls.commandA = true;
                    return super.catch(error);
                }
            }

            class CommandB extends CommandA {
                async execute() {throw new Error(`command failed`)}
                async catch(error: Error) {
                    calls.commandB = true;
                    return super.catch(error);
                }
            }

            return [
                CommandB,
            ];
        }, [])).to.be.rejectedWith(`command failed`);

        expect(Object.values(calls).every(Boolean)).to.be.true;
    });

    it(`should extract counter options from complex options`, async () => {
        class CommandA extends Command {
            @Command.Counter(`-v,--verbose`)
            verbose: number = 0;

            async execute() {}
        }

        const cli = Cli.from([CommandA]);

        expect(cli.process([])).to.contain({verbose: 0});
        expect(cli.process([`-v`])).to.contain({verbose: 1});
        expect(cli.process([`-vv`])).to.contain({verbose: 2});
        expect(cli.process([`-vvv`])).to.contain({verbose: 3});
        expect(cli.process([`-vvvv`])).to.contain({verbose: 4});

        expect(cli.process([`-v`, `-v`])).to.contain({verbose: 2});
        expect(cli.process([`--verbose`, `--verbose`])).to.contain({verbose: 2});
        expect(cli.process([`-v`, `--verbose`])).to.contain({verbose: 2});
        expect(cli.process([`--verbose`, `-v`])).to.contain({verbose: 2});

        expect(cli.process([`-vvvv`, `--no-verbose`])).to.contain({verbose: 0});
        expect(cli.process([`--no-verbose`, `-vvvv`])).to.contain({verbose: 4});
    });
});
