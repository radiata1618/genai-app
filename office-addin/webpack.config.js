const devCerts = require("office-addin-dev-certs");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const path = require("path");

module.exports = async (env, options) => {
    const dev = options.mode !== "production";
    const config = {
        devtool: "source-map",
        entry: {
            taskpane: "./src/taskpane.js",
        },
        output: {
            clean: true,
            path: path.resolve(__dirname, "dist"),
        },
        resolve: {
            extensions: [".html", ".js"],
        },
        module: {
            rules: [
                {
                    test: /\.html$/,
                    exclude: /node_modules/,
                    use: "html-loader",
                },
                {
                    test: /\.(png|jpg|jpeg|gif|ico)$/,
                    type: "asset/resource",
                    generator: {
                        filename: "assets/[name][ext][query]",
                    },
                },
            ],
        },
        plugins: [
            new HtmlWebpackPlugin({
                filename: "index.html",
                template: "./src/index.html",
                chunks: ["taskpane"],
            }),
            new CopyWebpackPlugin({
                patterns: [
                    {
                        from: "src/assets/*",
                        to: "assets/[name][ext][query]",
                    },
                    {
                        from: "src/taskpane.css",
                        to: "taskpane.css",
                    },
                    {
                        from: "manifest.xml",
                        to: "manifest.xml",
                        transform(content) {
                            if (dev) {
                                return content;
                            } else {
                                return content;
                            }
                        },
                    },
                ],
            }),
        ],
        devServer: {
            static: {
                directory: path.join(__dirname, "dist"),
            },
            headers: {
                "Access-Control-Allow-Origin": "*",
            },
            server: {
                type: "https",
                options: await getHttpsOptions(),
            },
            port: 3000,
            host: '0.0.0.0', // Important for Docker
            allowedHosts: "all",
            client: {
                webSocketURL: 'auto://0.0.0.0:0/ws',
            },
        },
    };

    return config;
};

async function getHttpsOptions() {
    const httpsOptions = await devCerts.getHttpsServerOptions();
    return { ca: httpsOptions.ca, cert: httpsOptions.cert, key: httpsOptions.key };
}
