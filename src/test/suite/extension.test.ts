import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

suite('Extension command smoke tests', () => {
	test('switch command respects workspace extra target settings', async () => {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		assert.ok(workspaceFolder, 'Expected the fixture workspace to be open.');
		const configuration = vscode.workspace.getConfiguration('livewireSwitcher', workspaceFolder.uri);

		const phpFilePath = path.join(
			workspaceFolder.uri.fsPath,
			'resources',
			'views',
			'livewire',
			'dashboard',
			'⚡orders',
			'orders.php'
		);
		const expectedBladePath = path.join(
			workspaceFolder.uri.fsPath,
			'resources',
			'views',
			'livewire',
			'dashboard',
			'⚡orders',
			'orders.blade.php'
		);
		const expectedJsPath = path.join(
			workspaceFolder.uri.fsPath,
			'resources',
			'views',
			'livewire',
			'dashboard',
			'⚡orders',
			'orders.js'
		);

		await configuration.update('multiFile.extraTargets', ['js'], vscode.ConfigurationTarget.Workspace);

		try {
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(phpFilePath));
			await vscode.window.showTextDocument(document);
			await vscode.commands.executeCommand('livewire-switcher.switch');

			assert.strictEqual(vscode.window.activeTextEditor?.document.uri.fsPath, expectedBladePath);

			await vscode.commands.executeCommand('livewire-switcher.switch');

			assert.strictEqual(vscode.window.activeTextEditor?.document.uri.fsPath, expectedJsPath);

			await vscode.commands.executeCommand('livewire-switcher.switch');

			assert.strictEqual(vscode.window.activeTextEditor?.document.uri.fsPath, phpFilePath);
		} finally {
			await configuration.update('multiFile.extraTargets', undefined, vscode.ConfigurationTarget.Workspace);
		}
	});
});
