import * as vscode from "vscode"
import { registerModeSwitchingCommands } from "../mode-switching"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { ModeConfig, modes, getAllModes } from "../../shared/modes"
import { logger } from "../../utils/logging"

// Mock dependencies
jest.mock("../../core/webview/ClineProvider", () => ({
	ClineProvider: {
		getInstance: jest.fn(),
	},
}))

jest.mock("../../utils/logging", () => ({
	logger: {
		info: jest.fn(),
		error: jest.fn(),
	},
}))

jest.mock("../../shared/modes", () => ({
	modes: [
		{ slug: "code", name: "Code", roleDefinition: "Code role" },
		{ slug: "architect", name: "Architect", roleDefinition: "Architect role" },
	],
	getAllModes: jest.fn(),
}))

// Simple mock for vscode
jest.mock("vscode", () => ({
	commands: {
		registerCommand: jest.fn(),
	},
	window: {
		showErrorMessage: jest.fn(),
	},
}))

describe("registerModeSwitchingCommands", () => {
	// Mock context
	const mockContext = {
		subscriptions: [],
		// Add more required properties
		workspaceState: { get: jest.fn(), update: jest.fn() },
		globalState: { get: jest.fn(), update: jest.fn(), keys: jest.fn() },
		secrets: { get: jest.fn(), store: jest.fn(), delete: jest.fn() },
		extensionUri: {} as vscode.Uri,
		extensionPath: "/test/path",
	} as unknown as vscode.ExtensionContext

	// Get reference to the mocked registerCommand
	const mockRegisterCommand = vscode.commands.registerCommand as jest.Mock

	beforeEach(() => {
		// Clear all mocks before each test
		jest.clearAllMocks()

		// Default mock implementations
		mockRegisterCommand.mockImplementation((commandId, callback) => {
			return { dispose: jest.fn() }
		})
	})

	it("should register the cycleModes command", () => {
		// Act
		registerModeSwitchingCommands(mockContext)

		// Assert
		expect(mockRegisterCommand).toHaveBeenCalledWith("roo-cline.cycleModes", expect.any(Function))
		expect(mockContext.subscriptions.length).toBe(1)
	})

	describe("cycleModes command", () => {
		// Setup to capture the command callback
		let cycleModeCallback: Function

		beforeEach(() => {
			mockRegisterCommand.mockImplementation((commandId, callback) => {
				if (commandId === "roo-cline.cycleModes") {
					cycleModeCallback = callback
				}
				return { dispose: jest.fn() }
			})

			// Register commands to capture the callback
			registerModeSwitchingCommands(mockContext)
		})

		it("should cycle to the next mode when current mode is found", async () => {
			// Arrange
			const allModes = [
				...modes,
				{ slug: "custom-mode", name: "Custom Mode", roleDefinition: "Custom role", groups: [] },
			]
			;(getAllModes as jest.Mock).mockReturnValue(allModes)

			const mockProvider = {
				getState: jest.fn().mockResolvedValue({
					mode: "code",
					customModes: [
						{ slug: "custom-mode", name: "Custom Mode", roleDefinition: "Custom role", groups: [] },
					],
				}),
				postMessageToWebview: jest.fn().mockResolvedValue(undefined),
			}
			;(ClineProvider.getInstance as jest.Mock).mockResolvedValue(mockProvider)

			// Find the index of 'code' mode in all modes
			const codeIndex = allModes.findIndex((mode) => mode.slug === "code")
			const expectedNextMode = allModes[(codeIndex + 1) % allModes.length]

			// Act
			await cycleModeCallback()

			// Assert
			expect(mockProvider.getState).toHaveBeenCalled()
			expect(getAllModes).toHaveBeenCalledWith([
				{ slug: "custom-mode", name: "Custom Mode", roleDefinition: "Custom role", groups: [] },
			])
			expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "mode",
				text: expectedNextMode.slug,
			})
		})

		it("should default to first mode when current mode is not found", async () => {
			// Arrange
			const customModes = [
				{ slug: "custom-mode", name: "Custom Mode", roleDefinition: "Custom role", groups: [] },
			]
			const allModes = [...modes, ...customModes]
			;(getAllModes as jest.Mock).mockReturnValue(allModes)

			const mockProvider = {
				getState: jest.fn().mockResolvedValue({
					mode: "nonexistent-mode",
					customModes: customModes,
				}),
				postMessageToWebview: jest.fn().mockResolvedValue(undefined),
			}
			;(ClineProvider.getInstance as jest.Mock).mockResolvedValue(mockProvider)

			// First mode in the list of all modes
			const expectedNextMode = allModes[0]

			// Act
			await cycleModeCallback()

			// Assert
			expect(mockProvider.getState).toHaveBeenCalled()
			expect(getAllModes).toHaveBeenCalledWith(customModes)
			expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "mode",
				text: expectedNextMode.slug,
			})
		})

		it("should handle errors when provider is not available", async () => {
			// Arrange
			;(ClineProvider.getInstance as jest.Mock).mockResolvedValue(null)

			// Act
			await cycleModeCallback()

			// Assert
			expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Failed to switch mode"))
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				expect.stringContaining("Failed to switch mode"),
			)
		})

		it("should handle errors in getState", async () => {
			// Arrange
			const allModes = [
				...modes,
				{ slug: "custom-mode", name: "Custom Mode", roleDefinition: "Custom role", groups: [] },
			]
			;(getAllModes as jest.Mock).mockReturnValue(allModes)

			const mockProvider = {
				getState: jest.fn().mockRejectedValue(new Error("State error")),
				postMessageToWebview: jest.fn().mockResolvedValue(undefined),
			}
			;(ClineProvider.getInstance as jest.Mock).mockResolvedValue(mockProvider)

			// Act
			await cycleModeCallback()

			// Assert
			expect(mockProvider.getState).toHaveBeenCalled()
			expect(mockProvider.postMessageToWebview).not.toHaveBeenCalled()
			expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Failed to switch mode"))
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				expect.stringContaining("Failed to switch mode"),
			)
		})

		it("should handle errors in postMessageToWebview", async () => {
			// Arrange
			const customModes = [
				{ slug: "custom-mode", name: "Custom Mode", roleDefinition: "Custom role", groups: [] },
			]
			const allModes = [...modes, ...customModes]
			;(getAllModes as jest.Mock).mockReturnValue(allModes)

			const mockProvider = {
				getState: jest.fn().mockResolvedValue({ mode: "code", customModes }),
				postMessageToWebview: jest.fn().mockRejectedValue(new Error("Webview error")),
			}
			;(ClineProvider.getInstance as jest.Mock).mockResolvedValue(mockProvider)

			// Act
			await cycleModeCallback()

			// Assert
			expect(mockProvider.getState).toHaveBeenCalled()
			expect(getAllModes).toHaveBeenCalledWith(customModes)
			expect(mockProvider.postMessageToWebview).toHaveBeenCalled()
			expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Failed to switch mode"))
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				expect.stringContaining("Failed to switch mode"),
			)
		})
	})
})
