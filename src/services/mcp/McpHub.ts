import * as vscode from "vscode"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { ConfigManager } from "./config"
import type { ConfigChangeEvent } from "./config"
import { ConnectionFactory, ConnectionManager, StdioHandler, SseHandler } from "./connection"
import { McpServer, McpToolCallResponse, McpResourceResponse, ServerConfig, ConfigSource, McpConnection } from "./types"

export class McpHub {
	private configManager: ConfigManager
	private connectionManager: ConnectionManager
	private disposables: vscode.Disposable[] = []
	private providerRef: WeakRef<ClineProvider>
	private isConnectingFlag = false

	constructor(private provider: ClineProvider) {
		this.providerRef = new WeakRef(provider)

		this.configManager = new ConfigManager()

		const connectionFactory = new ConnectionFactory(this.configManager, provider, (server: McpServer) =>
			this.notifyServersChanged(),
		)
		connectionFactory.registerHandler(new StdioHandler())
		connectionFactory.registerHandler(new SseHandler())

		this.connectionManager = new ConnectionManager(this.configManager, connectionFactory)

		this.setupEventHandlers()

		// Subscribe to configuration change events
		this.disposables.push(
			this.configManager.onConfigChange(async (event: ConfigChangeEvent) => {
				try {
					await this.connectionManager.updateServerConnections(event.configs, event.source)
					await this.notifyServersChanged()
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : `${error}`
					console.error("MCP configuration validation failed:", error)
					if (vscode.window && typeof vscode.window.showErrorMessage === "function") {
						vscode.window.showErrorMessage(`MCP configuration validation failed: ${errorMessage}`)
					}
				}
			}),
		)

		void this.initializeConnections()
		void this.configManager.watchConfigFiles(provider)
	}

	/**
	 * Execute a server action with common checks.
	 */
	private async executeServerAction<T>(
		serverName: string,
		source: ConfigSource | undefined,
		action: (connection: McpConnection) => Promise<T>,
	): Promise<T> {
		const servers = this.connectionManager.getAllServers()
		const server = servers.find((s) => s.name === serverName && (!source || s.source === source))
		if (!server) throw new Error(`Server not found: ${serverName}`)
		if (server.disabled) throw new Error(`Server "${serverName}" is disabled`)

		const connection = await this.connectionManager.getConnection(serverName, source)
		return action(connection)
	}

	/**
	 * Get config file path by source.
	 */
	private async getConfigPathBySource(source: ConfigSource): Promise<string> {
		const configPath =
			source === "global"
				? await this.configManager.getGlobalConfigPath(this.provider)
				: await this.configManager.getProjectConfigPath()
		if (!configPath) throw new Error(`Cannot get config path for source: ${source}`)
		return configPath
	}

	/**
	 * Create a promise with timeout.
	 */
	private createTimeoutPromise<T>(timeoutSeconds: number, promise: Promise<T>, operationName: string): Promise<T> {
		const timeoutMs = timeoutSeconds * 1000
		const timeoutPromise = new Promise<never>((_, reject) => {
			setTimeout(
				() => reject(new Error(`Operation "${operationName}" timed out after ${timeoutSeconds}s`)),
				timeoutMs,
			)
		})
		return Promise.race([promise, timeoutPromise])
	}

	/**
	 * Prepare server operation (get timeout).
	 */
	private prepareServerOperation(connection: McpConnection): { timeout: number } {
		const config = JSON.parse(connection.server.config)
		const timeout = config.timeout || 60
		return { timeout }
	}

	getServers(): McpServer[] {
		return this.connectionManager.getActiveServers()
	}

	getAllServers(): McpServer[] {
		return this.connectionManager.getAllServers()
	}

	async getGlobalConfigPath(provider: ClineProvider): Promise<string> {
		return this.configManager.getGlobalConfigPath(provider)
	}

	async callTool(
		serverName: string,
		toolName: string,
		toolArguments?: Record<string, unknown>,
		source?: ConfigSource,
	): Promise<McpToolCallResponse> {
		return this.executeServerAction(serverName, source, async (connection) => {
			const { timeout } = this.prepareServerOperation(connection)
			const callPromise = connection.client.callTool({
				name: toolName,
				arguments: toolArguments || {},
			})
			try {
				return (await this.createTimeoutPromise(
					timeout,
					callPromise,
					`callTool:${toolName}`,
				)) as McpToolCallResponse
			} catch (error) {
				console.error(`Failed to call tool ${toolName} on server ${serverName}:`, error)
				throw error
			}
		})
	}

	async readResource(serverName: string, uri: string, source?: ConfigSource): Promise<McpResourceResponse> {
		return this.executeServerAction(serverName, source, async (connection) => {
			const { timeout } = this.prepareServerOperation(connection)
			const readPromise = connection.client.readResource({ uri })
			try {
				return (await this.createTimeoutPromise(
					timeout,
					readPromise,
					`readResource:${uri}`,
				)) as McpResourceResponse
			} catch (error) {
				console.error(`Failed to read resource ${uri} from server ${serverName}:`, error)
				throw error
			}
		})
	}

	async deleteServer(serverName: string, source?: ConfigSource): Promise<void> {
		const serverSource = source || "global"
		const configPath = await this.getConfigPathBySource(serverSource)
		await this.configManager.deleteServerConfig(configPath, serverName)
		await this.connectionManager.updateServerConnections({}, serverSource)
		await this.notifyServersChanged()
	}

	async restartConnection(serverName: string, source?: ConfigSource): Promise<void> {
		await this.connectionManager.restartConnection(serverName, source)
		await this.notifyServersChanged()
	}

	async toggleToolAlwaysAllow(
		serverName: string,
		source: ConfigSource,
		toolName: string,
		allow: boolean,
	): Promise<void> {
		const configPath = await this.getConfigPathBySource(source)
		const configs = await this.configManager.readConfig(configPath)
		const serverConfig = configs[serverName] || {}
		const alwaysAllow = serverConfig.alwaysAllow || []
		const index = alwaysAllow.indexOf(toolName)

		if (allow && index === -1) {
			alwaysAllow.push(toolName)
		} else if (!allow && index !== -1) {
			alwaysAllow.splice(index, 1)
		}

		await this.updateServerConfigAndNotify(serverName, source, {
			...serverConfig,
			alwaysAllow,
		})
	}

	async toggleServerDisabled(serverName: string, disabled: boolean, source?: ConfigSource): Promise<void> {
		const server = this.connectionManager.getAllServers().find((s) => s.name === serverName)
		const serverSource = source || (server ? server.source : "global") || "global"
		await this.updateServerConfigAndNotify(serverName, serverSource, { disabled })
	}

	async updateServerTimeout(serverName: string, timeout: number, source?: ConfigSource): Promise<void> {
		if (timeout < 0 || timeout > 3600) {
			throw new Error(`Timeout must be between 0 and 3600 seconds, got ${timeout}`)
		}
		const server = this.connectionManager.getAllServers().find((s) => s.name === serverName)
		const serverSource = source || (server ? server.source : "global") || "global"
		await this.updateServerConfigAndNotify(serverName, serverSource, { timeout })
	}

	private async updateServerConfigAndNotify(
		serverName: string,
		source: ConfigSource,
		updates: Partial<ServerConfig>,
	): Promise<void> {
		const configPath = await this.getConfigPathBySource(source)
		await this.configManager.updateServerConfig(configPath, serverName, updates)
		const configs = await this.configManager.readConfig(configPath)
		await this.connectionManager.updateServerConnections(configs, source)
		await this.notifyServersChanged()
	}

	private async initializeConnections(): Promise<void> {
		this.isConnectingFlag = true
		try {
			await this.connectionManager.initializeConnections(this.provider)
			await this.notifyServersChanged()
		} finally {
			this.isConnectingFlag = false
		}
	}

	private setupEventHandlers(): void {
		// Skip if test environment is detected
		if (process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID !== undefined) {
			return
		}
		const disposable = vscode.workspace.onDidChangeWorkspaceFolders(async () => {
			await this.initializeConnections()
		})
		this.disposables.push(disposable)
	}

	private async notifyServersChanged(): Promise<void> {
		const provider = this.providerRef.deref()
		if (!provider) return
		try {
			const allServers = await this.configManager.getAllServersFromConfig(provider)
			const enhancedServers = await this.enhanceServersWithConnectionInfo(allServers)
			provider.postMessageToWebview({
				type: "mcpServers",
				mcpServers: enhancedServers,
			})
		} catch (error) {
			console.error("Failed to notify servers changed:", error)
		}
	}

	private async enhanceServersWithConnectionInfo(servers: McpServer[]): Promise<McpServer[]> {
		const connectedServers = this.connectionManager["factory"].getAllServers()
		for (const server of servers) {
			const connected = connectedServers.find((s) => s.name === server.name && s.source === server.source)
			if (connected) {
				server.tools = connected.tools
				server.resources = connected.resources
				server.resourceTemplates = connected.resourceTemplates
				server.status = connected.status
				server.error = connected.error
			}
			await this.updateToolAlwaysAllowStatus(server)
		}
		return servers
	}

	private async updateToolAlwaysAllowStatus(server: McpServer): Promise<void> {
		try {
			const source = server.source || "global"
			const configPath = await this.getConfigPathBySource(source as ConfigSource)
			const configs = await this.configManager.readConfig(configPath)
			const serverConfig = configs[server.name]
			const alwaysAllowList = serverConfig?.alwaysAllow ?? []
			if (Array.isArray(server.tools)) {
				server.tools = server.tools.map((tool) => ({
					...tool,
					alwaysAllow: alwaysAllowList.includes(tool.name),
				}))
			}
		} catch (e) {
			console.warn(`Failed to update alwaysAllow for server ${server.name}:`, e)
		}
	}

	get isConnecting(): boolean {
		return this.isConnectingFlag
	}

	async dispose(): Promise<void> {
		await this.connectionManager.dispose()
		this.disposables.forEach((d) => d.dispose())
	}
}
