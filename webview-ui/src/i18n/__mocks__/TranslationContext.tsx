import React from "react"

// Create a mock for the useAppTranslation hook
export const useAppTranslation = () => {
	return {
		t: (key: string, options?: Record<string, any>) => {
			const translations: Record<string, string> = {
				// Common translations
				"common:cancel": "Cancel",
				// History translations
				"history:recentTasks": "Recent Tasks",
				"history:viewAll": "View All",
				"history:history": "History",
				"history:exitSelectionMode": "Exit Selection Mode",
				"history:enterSelectionMode": "Enter Selection Mode",
				"history:done": "Done",
				"history:searchPlaceholder": "Fuzzy search history...",
				"history:newest": "Newest",
				"history:oldest": "Oldest",
				"history:mostExpensive": "Most Expensive",
				"history:mostTokens": "Most Tokens",
				"history:mostRelevant": "Most Relevant",
				"history:deleteTaskTitle": "Delete Task (Shift + Click to skip confirmation)",
				"history:tokensLabel": "Tokens:",
				"history:cacheLabel": "Cache:",
				"history:apiCostLabel": "API Cost:",
				"history:copyPrompt": "Copy Prompt",
				"history:exportTask": "Export Task",
				"history:deleteTask": "Delete Task",
				"history:deleteTaskMessage": "Are you sure you want to delete this task? This action cannot be undone.",
				"history:cancel": "Cancel",
				"history:delete": "Delete",
				"history:exitSelection": "Exit Selection",
				"history:selectionMode": "Selection Mode",
				"history:deselectAll": "Deselect All",
				"history:selectAll": "Select All",
				"history:selectedItems": "Selected {selected}/{total} items",
				"history:clearSelection": "Clear Selection",
				"history:deleteSelected": "Delete Selected",
				"history:deleteTasks": "Delete Tasks",
				"history:confirmDeleteTasks":
					"Are you sure you want to delete {count} tasks? This action cannot be undone.",
				"history:deleteTasksWarning":
					"Deleted tasks cannot be recovered. Please make sure you want to proceed.",
				"history:deleteItems": "Delete {count} Items",
			}

			// Handle interpolation
			if (options && key === "history:tokens") {
				return `Tokens: ↑${options.in} ↓${options.out}`
			}

			if (options && key === "history:cache") {
				return `Cache: +${options.writes} → ${options.reads}`
			}

			if (options && key === "history:apiCost") {
				return `API Cost: $${options.cost}`
			}

			return translations[key] || key
		},
		i18n: {
			language: "en",
			changeLanguage: jest.fn(),
		},
	}
}

export const withTranslation = (Component: React.ComponentType<any>) => {
	return (props: any) => <Component {...props} />
}

// Mock provider component
export const AppTranslationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	return <>{children}</>
}

const TranslationContext = { AppTranslationProvider, useAppTranslation, withTranslation }
export default TranslationContext
