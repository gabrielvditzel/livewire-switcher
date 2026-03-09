import * as vscode from 'vscode';
import { MultiFileExtraTarget, resolveSwitchTarget } from './livewire';

const VALID_MULTI_FILE_EXTRA_TARGETS: MultiFileExtraTarget[] = ['js', 'test'];

export function activate(context: vscode.ExtensionContext) {
	const disposable = vscode.commands.registerCommand('livewire-switcher.switch', async () => {
		const activeEditor = vscode.window.activeTextEditor;
		if (!activeEditor) {
			void vscode.window.showInformationMessage('Open a Livewire component file before using Livewire Switcher.');
			return;
		}

		const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
		if (!workspaceFolder) {
			void vscode.window.showInformationMessage('Open the file from a workspace to use Livewire Switcher.');
			return;
		}

		const configuration = vscode.workspace.getConfiguration('livewireSwitcher', activeEditor.document.uri);
		const enabledExtraTargets = normalizeEnabledExtraTargets(
			configuration.get<unknown>('multiFile.extraTargets')
		);

		const resolution = await resolveSwitchTarget(
			workspaceFolder.uri.fsPath,
			activeEditor.document.uri.fsPath,
			{ enabledExtraTargets }
		);

		if (resolution.kind === 'noop') {
			if (resolution.reason === 'missing-counterpart') {
				void vscode.window.showWarningMessage(resolution.message);
				return;
			}

			void vscode.window.showInformationMessage(resolution.message);
			return;
		}

		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(resolution.targetPath));
		await vscode.window.showTextDocument(document);
	});

	context.subscriptions.push(disposable);
}

export function deactivate() {}

function normalizeEnabledExtraTargets(value: unknown): MultiFileExtraTarget[] {
	if (!Array.isArray(value)) {
		return [...VALID_MULTI_FILE_EXTRA_TARGETS];
	}

	return VALID_MULTI_FILE_EXTRA_TARGETS.filter((target) => value.includes(target));
}
