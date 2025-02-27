import * as vscode from "vscode"
import { ModeConfig, modes, getAllModes } from "../shared/modes"
import { ClineProvider } from "../core/webview/ClineProvider"
import { logger } from "../utils/logging"

export function registerModeSwitchingCommands(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand("roo-cline.cycleModes", async () => {
			try {
				// Get provider instance
				const provider = await ClineProvider.getInstance()
				if (!provider) {
					throw new Error("No active Cline provider found")
				}

				// Get current mode and custom modes from provider state
				const state = await provider.getState()
				const currentModeSlug = state.mode
				const customModes = state.customModes || []

				// Get all modes including custom modes
				const allModes = getAllModes(customModes)

				// Find current mode index in the combined array
				const currentModeIndex = allModes.findIndex((mode) => mode.slug === currentModeSlug)

				// Get next mode index, defaulting to first mode if current mode not found
				const nextModeIndex = (currentModeIndex + 1) % allModes.length
				const nextMode = allModes[nextModeIndex]

				// Send message to webview to switch mode
				await provider.postMessageToWebview({
					type: "mode",
					text: nextMode.slug,
				})
			} catch (error) {
				logger.error(`Failed to switch mode: ${error}`)
				vscode.window.showErrorMessage(`Failed to switch mode: ${error}`)
			}
		}),
	)
}
