import * as assert from 'assert';
import * as path from 'path';
import {
	loadLivewireConfig,
	NoopReason,
	resolveSwitchTarget,
	SwitchResolution,
} from '../../livewire';

const fixturesRoot = path.resolve(__dirname, '../../../src/test/fixtures');
const defaultWorkspaceRoot = path.join(fixturesRoot, 'default-workspace');
const customWorkspaceRoot = path.join(fixturesRoot, 'custom-config-workspace');

suite('Livewire resolver', () => {
	test('loads default roots when config/livewire.php is missing', async () => {
		const config = await loadLivewireConfig(defaultWorkspaceRoot);

		assertConfigPath(config.legacyViewPath, defaultWorkspaceRoot, 'resources', 'views', 'livewire');
		assert.deepStrictEqual(
			config.legacyClassRoots,
			[
				path.join(defaultWorkspaceRoot, 'app', 'Http', 'Livewire'),
				path.join(defaultWorkspaceRoot, 'app', 'Livewire'),
			]
		);
		assert.deepStrictEqual(
			config.componentLocations,
			[
				path.join(defaultWorkspaceRoot, 'resources', 'views', 'components'),
				path.join(defaultWorkspaceRoot, 'resources', 'views', 'livewire'),
			]
		);
		assert.deepStrictEqual(config.componentNamespaces, {
			layouts: path.join(defaultWorkspaceRoot, 'resources', 'views', 'layouts'),
			pages: path.join(defaultWorkspaceRoot, 'resources', 'views', 'pages'),
		});
	});

	test('loads custom roots from config/livewire.php', async () => {
		const config = await loadLivewireConfig(customWorkspaceRoot);

		assertConfigPath(config.legacyViewPath, customWorkspaceRoot, 'resources', 'views', 'custom-livewire');
		assert.deepStrictEqual(
			config.legacyClassRoots,
			[
				path.join(customWorkspaceRoot, 'app', 'Domains', 'Livewire'),
				path.join(customWorkspaceRoot, 'app', 'Http', 'Livewire'),
				path.join(customWorkspaceRoot, 'app', 'Livewire'),
			]
		);
		assert.deepStrictEqual(config.componentLocations, [
			path.join(customWorkspaceRoot, 'resources', 'views', 'ui'),
		]);
		assert.deepStrictEqual(config.componentNamespaces, {
			dash: path.join(customWorkspaceRoot, 'resources', 'views', 'dashboards'),
		});
	});

	test('switches legacy Blade views to App\\Http\\Livewire classes first', async () => {
		const resolution = await resolveSwitchTarget(
			defaultWorkspaceRoot,
			path.join(defaultWorkspaceRoot, 'resources', 'views', 'livewire', 'legacy-http', 'orders-list.blade.php')
		);

		assertTarget(
			resolution,
			path.join(defaultWorkspaceRoot, 'app', 'Http', 'Livewire', 'LegacyHttp', 'OrdersList.php')
		);
	});

	test('switches legacy Blade views to App\\Livewire when App\\Http\\Livewire does not contain the class', async () => {
		const resolution = await resolveSwitchTarget(
			defaultWorkspaceRoot,
			path.join(defaultWorkspaceRoot, 'resources', 'views', 'livewire', 'legacy', 'account-settings.blade.php')
		);

		assertTarget(
			resolution,
			path.join(defaultWorkspaceRoot, 'app', 'Livewire', 'Legacy', 'AccountSettings.php')
		);
	});

	test('switches legacy classes back to the configured Livewire Blade view', async () => {
		const resolution = await resolveSwitchTarget(
			defaultWorkspaceRoot,
			path.join(defaultWorkspaceRoot, 'app', 'Http', 'Livewire', 'LegacyHttp', 'OrdersList.php')
		);

		assertTarget(
			resolution,
			path.join(defaultWorkspaceRoot, 'resources', 'views', 'livewire', 'legacy-http', 'orders-list.blade.php')
		);
	});

	test('switches default multi-file components inside resources/views/components', async () => {
		const resolution = await resolveSwitchTarget(
			defaultWorkspaceRoot,
			path.join(defaultWorkspaceRoot, 'resources', 'views', 'components', 'admin', '⚡user-table', 'user-table.php')
		);

		assertTarget(
			resolution,
			path.join(defaultWorkspaceRoot, 'resources', 'views', 'components', 'admin', '⚡user-table', 'user-table.blade.php')
		);
	});

	test('switches default multi-file components inside namespace roots', async () => {
		const resolution = await resolveSwitchTarget(
			defaultWorkspaceRoot,
			path.join(defaultWorkspaceRoot, 'resources', 'views', 'pages', '⚡settings-page', 'settings-page.blade.php')
		);

		assertTarget(
			resolution,
			path.join(defaultWorkspaceRoot, 'resources', 'views', 'pages', '⚡settings-page', 'settings-page.php')
		);
	});

	test('switches nested multi-file components in resources/views/livewire before considering legacy mapping', async () => {
		const resolution = await resolveSwitchTarget(
			defaultWorkspaceRoot,
			path.join(defaultWorkspaceRoot, 'resources', 'views', 'livewire', 'dashboard', '⚡orders', 'orders.blade.php')
		);

		assertTarget(
			resolution,
			path.join(defaultWorkspaceRoot, 'resources', 'views', 'livewire', 'dashboard', '⚡orders', 'orders.php')
		);
	});

	test('does not switch auxiliary multi-file assets', async () => {
		const resolution = await resolveSwitchTarget(
			defaultWorkspaceRoot,
			path.join(defaultWorkspaceRoot, 'resources', 'views', 'livewire', 'dashboard', '⚡orders', 'orders.js')
		);

		assertNoop(resolution, 'auxiliary');
	});

	test('treats standalone Blade files in view-based roots as single-file components', async () => {
		const resolution = await resolveSwitchTarget(
			defaultWorkspaceRoot,
			path.join(defaultWorkspaceRoot, 'resources', 'views', 'components', 'profile-card.blade.php')
		);

		assertNoop(resolution, 'single-file');
	});

	test('treats direct Blade files in resources/views/livewire without a class counterpart as single-file components', async () => {
		const resolution = await resolveSwitchTarget(
			defaultWorkspaceRoot,
			path.join(defaultWorkspaceRoot, 'resources', 'views', 'livewire', 'standalone.blade.php')
		);

		assertNoop(resolution, 'single-file');
	});

	test('reports missing counterparts for incomplete multi-file components', async () => {
		const missingBladePath = path.join(
			defaultWorkspaceRoot,
			'resources',
			'views',
			'components',
			'broken',
			'⚡missing',
			'missing.php'
		);
		const resolution = await resolveSwitchTarget(defaultWorkspaceRoot, missingBladePath);

		assertNoop(
			resolution,
			'missing-counterpart',
			path.join(defaultWorkspaceRoot, 'resources', 'views', 'components', 'broken', '⚡missing', 'missing.blade.php')
		);
	});

	test('reports missing counterparts for legacy classes with no Blade view', async () => {
		const resolution = await resolveSwitchTarget(
			defaultWorkspaceRoot,
			path.join(defaultWorkspaceRoot, 'app', 'Livewire', 'MissingView.php')
		);

		assertNoop(
			resolution,
			'missing-counterpart',
			path.join(defaultWorkspaceRoot, 'resources', 'views', 'livewire', 'missing-view.blade.php')
		);
	});

	test('supports custom class_path and view_path settings', async () => {
		const classResolution = await resolveSwitchTarget(
			customWorkspaceRoot,
			path.join(customWorkspaceRoot, 'app', 'Domains', 'Livewire', 'Billing', 'InvoiceTable.php')
		);
		const bladeResolution = await resolveSwitchTarget(
			customWorkspaceRoot,
			path.join(customWorkspaceRoot, 'resources', 'views', 'custom-livewire', 'billing', 'invoice-table.blade.php')
		);

		assertTarget(
			classResolution,
			path.join(customWorkspaceRoot, 'resources', 'views', 'custom-livewire', 'billing', 'invoice-table.blade.php')
		);
		assertTarget(
			bladeResolution,
			path.join(customWorkspaceRoot, 'app', 'Domains', 'Livewire', 'Billing', 'InvoiceTable.php')
		);
	});

	test('supports custom component locations and namespace roots from config/livewire.php', async () => {
		const locationResolution = await resolveSwitchTarget(
			customWorkspaceRoot,
			path.join(customWorkspaceRoot, 'resources', 'views', 'ui', 'reports', '⚡revenue', 'revenue.php')
		);
		const namespaceResolution = await resolveSwitchTarget(
			customWorkspaceRoot,
			path.join(customWorkspaceRoot, 'resources', 'views', 'dashboards', '⚡sales', 'sales.blade.php')
		);

		assertTarget(
			locationResolution,
			path.join(customWorkspaceRoot, 'resources', 'views', 'ui', 'reports', '⚡revenue', 'revenue.blade.php')
		);
		assertTarget(
			namespaceResolution,
			path.join(customWorkspaceRoot, 'resources', 'views', 'dashboards', '⚡sales', 'sales.php')
		);
	});

	test('returns unsupported for files outside Livewire roots', async () => {
		const resolution = await resolveSwitchTarget(
			defaultWorkspaceRoot,
			path.join(defaultWorkspaceRoot, 'README.md')
		);

		assertNoop(resolution, 'unsupported');
	});
});

function assertConfigPath(actualPath: string, workspaceRoot: string, ...segments: string[]): void {
	assert.strictEqual(actualPath, path.join(workspaceRoot, ...segments));
}

function assertTarget(resolution: SwitchResolution, expectedPath: string): void {
	assert.strictEqual(resolution.kind, 'target');
	if (resolution.kind === 'target') {
		assert.strictEqual(resolution.targetPath, expectedPath);
	}
}

function assertNoop(
	resolution: SwitchResolution,
	expectedReason: NoopReason,
	expectedPath?: string
): void {
	assert.strictEqual(resolution.kind, 'noop');
	if (resolution.kind === 'noop') {
		assert.strictEqual(resolution.reason, expectedReason);
		if (expectedPath) {
			assert.ok(resolution.searchedPaths?.includes(expectedPath));
			assert.ok(resolution.message.includes(expectedPath));
		}
	}
}
