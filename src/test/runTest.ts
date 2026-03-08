import * as fs from 'fs';
import * as path from 'path';

import { runTests } from '@vscode/test-electron';

async function main() {
	try {
		const extensionDevelopmentPath = path.resolve(__dirname, '../../');
		const extensionTestsPath = path.resolve(__dirname, './suite/index');
		const fixtureWorkspacePath = path.resolve(__dirname, '../../src/test/fixtures/default-workspace');
		const preferredExecutablePaths = [
			process.env.VSCODE_EXEC_PATH,
			process.platform === 'darwin'
				? '/Applications/Visual Studio Code.app/Contents/MacOS/Electron'
				: undefined,
		].filter((value): value is string => Boolean(value));
		const vscodeExecutablePath = preferredExecutablePaths.find((candidatePath) => fs.existsSync(candidatePath));

		await runTests({
			extensionDevelopmentPath,
			extensionTestsPath,
			launchArgs: [fixtureWorkspacePath, '--disable-extensions'],
			...(vscodeExecutablePath ? { vscodeExecutablePath } : {}),
		});
	} catch (err) {
		console.error('Failed to run tests');
		process.exit(1);
	}
}

main();
