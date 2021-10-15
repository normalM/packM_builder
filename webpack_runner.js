const webpack = require("webpack")
const path = require("path")
const fs = require("fs")
const { CleanWebpackPlugin } = require("clean-webpack-plugin")
const WatchExternalFilesPlugin = require("webpack-watch-files-plugin").default
const exec = require("child-process-promise").exec
const WebpackObfuscator = require("webpack-obfuscator")
const process = require("process")
const glob = require("glob")

const ensureArray = (config) =>
    (config && (Array.isArray(config) ? config : [config])) || []
const whenA = (condition, config, negativeConfig) =>
    condition ? ensureArray(config) : ensureArray(negativeConfig)
const ensureObject = (config) =>
    (config && (typeof config === "object" ? config : { config })) || {}
const whenO = (condition, config, negativeConfig) =>
    condition ? ensureObject(config) : ensureObject(negativeConfig)

function getStat(path) {
    try {
        const stat = fs.statSync(path)

        return stat
            ? {
                  mtime: stat.mtimeMs,
                  size: stat.size,
                  inode: stat.ino,
              }
            : null
    } catch {
        return null
    }
}

class SaveStatePlugin {
    constructor(inp) {
        this.cache = []
        this.cachePath = inp.cachePath
        this.resourcePath = inp.resourcePath
    }

    apply(compiler) {
        compiler.hooks.afterCompile.tap("SaveStatePlugin", (compilation) => {
            for (const file of compilation.fileDependencies) {
                this.cache.push({
                    name: file,
                    stats: getStat(file),
                })
            }
            const rp = this.resourcePath
            let ca = this.cache
            glob("src/**/*.go", { cwd: rp }, function (er, files) {
                for (const p of files) {
                    let file = path.resolve(rp, p)

                    ca.push({
                        name: file,
                        stats: getStat(file),
                    })
                }
            })
        })

        compiler.hooks.done.tap("SaveStatePlugin", (stats) => {
            if (stats.hasErrors()) {
                return
            }

            fs.writeFile(this.cachePath, JSON.stringify(this.cache), () => {})
        })
    }
}
class WatchRunPlugin {
    constructor(gobuild, rcon, resourcePath) {
        this.gobuild = gobuild
        this.rcon = rcon
        this.resourcePath = resourcePath
    }
    apply(compiler) {
        // compiler.hooks.done.tap("WatchRun", async (comp) => {
        //     await this.buildGO()
        //     if (!this.rcon.autorestart) return
        //     let result = await exec(
        //         `${path.join(
        //             __dirname,
        //             `/bin/icecon_${process.platform}_amd64`
        //         )} -c "restart ${path.basename(__dirname)}" ${this.rcon.addr} ${
        //             this.rcon.password
        //         }`
        //     )
        //     console.log("\n", result.stdout)
        // })
        compiler.hooks.beforeRun.tap(
            "GoBuildWebpackPlugin",
            (compilation, cb) => {
                this.buildGO().then()
                if (!this.rcon.autorestart) return

                // exec(
                //     `${path.join(
                //         __dirname,
                //         `/bin/icecon_${process.platform}_amd64`
                //     )} -c "stop ${path.basename(this.resourcePath)}" ${
                //         this.rcon.addr
                //     } ${this.rcon.password}`
                // ).then((result) => {
                //     // console.log("\n", result.stdout)
                // })
                // exec(
                //     `${path.join(
                //         __dirname,
                //         `/bin/icecon_${process.platform}_amd64`
                //     )} -c "start ${path.basename(this.resourcePath)}" ${
                //         this.rcon.addr
                //     } ${this.rcon.password}`
                // ).then((result) => {
                //     // console.log("\n", result.stdout)
                // })
            }
        )
    }
    async buildGO() {
        if (this.gobuild.length == 0) return
        for (const b of this.gobuild) {
            try {
                if (b.exec) {
                    await exec(b.exec, {
                        cwd: b.cwd || "",
                        env: b.env,
                    })
                } else {
                    await exec(
                        `go build -o ${b.outputPath} ${b.resourcePath}`,
                        {
                            cwd: b.cwd || "",
                            env: b.env,
                        }
                    )
                }
            } catch (error) {
                return error
            }
        }
    }
}
module.exports = (inp, callback) => {
    const packm = require(inp.configPath)
    const config = {
        mode: packm.webpack.mode == "production" ? "production" : "development",
        entry: {
            ...whenO(packm.server.typescript.enable, {
                server: packm.server.typescript.main,
            }),
            ...whenO(packm.client.typescript.enable, {
                client: packm.client.typescript.main,
            }),
            ...whenO(packm.shared.typescript.enable, {
                shared: packm.shared.typescript.main,
            }),
        },
        cache: packm.webpack.cache,
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    loader: "ts-loader",
                    exclude: /node_modules/,
                },
            ],
        },
        plugins: [
            // new webpack.ProgressPlugin(),
            new CleanWebpackPlugin({
                cleanOnceBeforeBuildPatterns: ["**/*.js", "**/*.txt"],
            }),
            new WatchExternalFilesPlugin({
                files: ["./src/**/*.js", "./src/**/*.ts", "./src/**/*.go"],
            }),
            new WatchRunPlugin(
                [
                    ...whenA(packm.server.go.enable, {
                        env: { ...process.env, GOOS: "js", GOARCH: "wasm" },
                        cwd: path.resolve(inp.resourcePath),
                        outputPath: path.join(
                            inp.resourcePath,
                            "./dist/server/go.wasm"
                        ),
                        resourcePath: path.resolve(
                            inp.resourcePath,
                            "./src/server/"
                        ),
                    }),
                    ...whenA(packm.client.go.enable, {
                        env: { ...process.env },
                        cwd: path.resolve(inp.resourcePath),
                        exec: packm.client.go.exec,
                    }),
                ],
                packm.rcon,
                inp.resourcePath
            ),
            ...whenA(
                packm.webpack.mode == "production",
                new WebpackObfuscator(
                    { rotateStringArray: true, reservedStrings: ["s*"] },
                    []
                )
            ),
        ],
        performance: {
            hints: false,
            maxEntrypointSize: 512000,
            maxAssetSize: 512000,
        },

        resolve: {
            extensions: [".ts", ".js"],
            // fallback: { util: require.resolve("util") },
        },
        target: ["node"],
        experiments: {
            topLevelAwait: true,
        },
        optimization: {
            minimize: packm.webpack.mode === "production" ? true : false,
            moduleIds:
                packm.webpack.mode === "production" ? "deterministic" : "named",
        },
        output: {
            filename:
                packm.webpack.mode === "production"
                    ? "[name]/" + packm.webpack.filename.production
                    : "[name]/" + packm.webpack.filename.development,
            path: "./dist/",
        },
    }

    config.context = inp.resourcePath

    if (config.output && config.output.path) {
        config.output.path = path.resolve(inp.resourcePath, config.output.path)
    }
    if (!config.plugins) {
        config.plugins = []
    }

    config.plugins.push(new SaveStatePlugin(inp))

    webpack(config, (err, stats) => {
        if (err) {
            callback(err)
            return
        }

        if (stats.hasErrors()) {
            callback(null, stats.toJson())
            return
        }

        callback(null, {})
    })
}
