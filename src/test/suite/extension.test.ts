import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

suite('Extension command smoke tests', () => {
	test('switch command opens the paired multi-file Blade view', async () => {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		assert.ok(workspaceFolder, 'Expected the fixture workspace to be open.');

		const phpFilePath = path.join(
			workspaceFolder.uri.fsPath,
			'resources',
			'views',
			'components',
			'admin',
			'⚡user-table',
			'user-table.php'
		);
		const expectedBladePath = path.join(
			workspaceFolder.uri.fsPath,
			'resources',
			'views',
			'components',
			'admin',
			'⚡user-table',
			'user-table.blade.php'
		);

		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(phpFilePath));
		await vscode.window.showTextDocument(document);
		await vscode.commands.executeCommand('livewire-switcher.switch');

		assert.strictEqual(vscode.window.activeTextEditor?.document.uri.fsPath, expectedBladePath);
	});
});
