import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_LEGACY_VIEW_PATH = 'resources/views/livewire';
const DEFAULT_LEGACY_CLASS_ROOTS = ['app/Http/Livewire', 'app/Livewire'];
const DEFAULT_COMPONENT_LOCATIONS = ['resources/views/components', 'resources/views/livewire'];
const DEFAULT_COMPONENT_NAMESPACES: Record<string, string> = {
	layouts: 'resources/views/layouts',
	pages: 'resources/views/pages',
};

export type NoopReason = 'unsupported' | 'single-file' | 'auxiliary' | 'missing-counterpart';

export interface ResolvedLivewireConfig {
	legacyViewPath: string;
	legacyClassRoots: string[];
	componentLocations: string[];
	componentNamespaces: Record<string, string>;
	componentRoots: string[];
}

export type SwitchResolution =
	| {
		kind: 'target';
		targetPath: string;
	}
	| {
		kind: 'noop';
		reason: NoopReason;
		message: string;
		searchedPaths?: string[];
	};

type SwitchableFileKind = 'blade' | 'php' | 'js' | 'test';
type FileKind = SwitchableFileKind | 'auxiliary' | 'unsupported';

const MULTI_FILE_CYCLE: SwitchableFileKind[] = ['php', 'blade', 'js', 'test'];

interface FileDescriptor {
	kind: FileKind;
	baseName?: string;
}

interface ParsedConfigOverrides {
	classPath?: string;
	viewPath?: string;
	componentLocations?: string[];
	componentNamespaces?: Record<string, string>;
}

export async function loadLivewireConfig(workspaceRoot: string): Promise<ResolvedLivewireConfig> {
	const normalizedRoot = path.resolve(workspaceRoot);
	const overrides = await readLivewireConfigOverrides(normalizedRoot);

	const legacyViewPath = normalizeConfiguredPath(
		normalizedRoot,
		overrides.viewPath ?? DEFAULT_LEGACY_VIEW_PATH
	);
	const legacyClassRoots = dedupePaths([
		overrides.classPath ? normalizeConfiguredPath(normalizedRoot, overrides.classPath) : '',
		...DEFAULT_LEGACY_CLASS_ROOTS.map((relativePath) => normalizeConfiguredPath(normalizedRoot, relativePath)),
	].filter(Boolean));

	const componentLocations = dedupePaths(
		(overrides.componentLocations ?? DEFAULT_COMPONENT_LOCATIONS).map((componentLocation) =>
			normalizeConfiguredPath(normalizedRoot, componentLocation)
		)
	);

	const componentNamespaces = Object.entries(overrides.componentNamespaces ?? DEFAULT_COMPONENT_NAMESPACES).reduce<Record<string, string>>(
		(result, [namespace, namespacePath]) => {
			result[namespace] = normalizeConfiguredPath(normalizedRoot, namespacePath);
			return result;
		},
		{}
	);

	const componentRoots = dedupePaths([
		...componentLocations,
		...Object.values(componentNamespaces),
	]).sort((left, right) => right.length - left.length);

	return {
		legacyViewPath,
		legacyClassRoots,
		componentLocations,
		componentNamespaces,
		componentRoots,
	};
}

export async function resolveSwitchTarget(
	workspaceRoot: string,
	activeFilePath: string
): Promise<SwitchResolution> {
	const normalizedRoot = path.resolve(workspaceRoot);
	const normalizedFilePath = path.resolve(activeFilePath);
	const config = await loadLivewireConfig(normalizedRoot);

	const multiFileResolution = await resolveMultiFileSwitch(config, normalizedFilePath);
	if (multiFileResolution) {
		return multiFileResolution;
	}

	const legacyClassResolution = await resolveLegacyClassSwitch(config, normalizedFilePath);
	if (legacyClassResolution) {
		return legacyClassResolution;
	}

	const legacyBladeResolution = await resolveLegacyBladeSwitch(config, normalizedFilePath);
	if (legacyBladeResolution) {
		return legacyBladeResolution;
	}

	const viewBasedNoopResolution = resolveViewBasedNoop(config, normalizedFilePath);
	if (viewBasedNoopResolution) {
		return viewBasedNoopResolution;
	}

	return buildNoop('unsupported', 'This file is not a supported Livewire component file.');
}

async function readLivewireConfigOverrides(workspaceRoot: string): Promise<ParsedConfigOverrides> {
	const configPath = path.join(workspaceRoot, 'config', 'livewire.php');

	try {
		const rawContents = await fs.promises.readFile(configPath, 'utf8');
		const contents = stripPhpComments(rawContents);
		const classPath = parsePathExpression(extractValueExpression(contents, 'class_path'), workspaceRoot);
		const viewPath = parsePathExpression(extractValueExpression(contents, 'view_path'), workspaceRoot);
		const componentLocations = parsePathListExpression(extractValueExpression(contents, 'component_locations'), workspaceRoot);
		const componentNamespaces = parseNamespaceMapExpression(extractValueExpression(contents, 'component_namespaces'), workspaceRoot);

		return {
			classPath,
			viewPath,
			componentLocations: componentLocations.length > 0 ? componentLocations : undefined,
			componentNamespaces: Object.keys(componentNamespaces).length > 0 ? componentNamespaces : undefined,
		};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return {};
		}

		return {};
	}
}

async function resolveMultiFileSwitch(
	config: ResolvedLivewireConfig,
	activeFilePath: string
): Promise<SwitchResolution | undefined> {
	const componentRoot = findContainingRoot(activeFilePath, config.componentRoots);
	if (!componentRoot) {
		return undefined;
	}

	const relativePath = path.relative(componentRoot, activeFilePath);
	const segments = relativePath.split(path.sep);
	if (segments.length < 2) {
		return undefined;
	}

	const parentDirectory = segments[segments.length - 2];
	const fileDescriptor = describeFile(path.basename(activeFilePath));
	if (!fileDescriptor.baseName) {
		return undefined;
	}

	const normalizedComponentName = stripEmojiPrefix(parentDirectory);
	if (!normalizedComponentName || fileDescriptor.baseName !== normalizedComponentName) {
		return undefined;
	}

	if (fileDescriptor.kind === 'auxiliary') {
		return buildNoop('auxiliary', 'Auxiliary Livewire multi-file assets do not have a switch target.');
	}

	if (fileDescriptor.kind === 'unsupported') {
		return undefined;
	}

	const candidatePaths = getOrderedMultiFileCandidatePaths(
		path.dirname(activeFilePath),
		normalizedComponentName,
		fileDescriptor.kind
	);

	for (const candidatePath of candidatePaths) {
		if (await pathExists(candidatePath)) {
			return {
				kind: 'target',
				targetPath: candidatePath,
			};
		}
	}

	return buildMissingCounterpart(
		`No other switchable Livewire multi-file component files were found. Looked for: ${candidatePaths.join(', ')}`,
		candidatePaths
	);
}

async function resolveLegacyClassSwitch(
	config: ResolvedLivewireConfig,
	activeFilePath: string
): Promise<SwitchResolution | undefined> {
	const classRoot = findContainingRoot(activeFilePath, config.legacyClassRoots);
	if (!classRoot || path.extname(activeFilePath) !== '.php') {
		return undefined;
	}

	const relativeClassPath = path.relative(classRoot, activeFilePath);
	const targetPath = path.join(config.legacyViewPath, classRelativePathToBlade(relativeClassPath));

	if (await pathExists(targetPath)) {
		return {
			kind: 'target',
			targetPath,
		};
	}

	return buildMissingCounterpart(
		`No matching Livewire Blade view was found. Looked for: ${targetPath}`,
		[targetPath]
	);
}

async function resolveLegacyBladeSwitch(
	config: ResolvedLivewireConfig,
	activeFilePath: string
): Promise<SwitchResolution | undefined> {
	const legacyViewRoot = findContainingRoot(activeFilePath, [config.legacyViewPath]);
	if (!legacyViewRoot || !activeFilePath.endsWith('.blade.php')) {
		return undefined;
	}

	const relativeBladePath = path.relative(legacyViewRoot, activeFilePath);
	const classRelativePath = bladeRelativePathToClass(relativeBladePath);
	const classCandidates = config.legacyClassRoots.map((classRoot) => path.join(classRoot, classRelativePath));

	for (const classCandidate of classCandidates) {
		if (await pathExists(classCandidate)) {
			return {
				kind: 'target',
				targetPath: classCandidate,
			};
		}
	}

	if (findContainingRoot(activeFilePath, config.componentRoots)) {
		return buildNoop(
			'single-file',
			'This Livewire view-based component does not have a paired class file to switch to.'
		);
	}

	return buildMissingCounterpart(
		`No matching Livewire component class was found. Looked for: ${classCandidates.join(', ')}`,
		classCandidates
	);
}

function resolveViewBasedNoop(
	config: ResolvedLivewireConfig,
	activeFilePath: string
): SwitchResolution | undefined {
	const componentRoot = findContainingRoot(activeFilePath, config.componentRoots);
	if (!componentRoot) {
		return undefined;
	}

	const fileDescriptor = describeFile(path.basename(activeFilePath));
	if (fileDescriptor.kind === 'auxiliary') {
		return buildNoop('auxiliary', 'Auxiliary Livewire multi-file assets do not have a switch target.');
	}

	if (fileDescriptor.kind === 'blade') {
		return buildNoop('single-file', 'This Livewire view-based component is single-file and has no paired PHP file.');
	}

	return buildNoop('unsupported', 'This file is not a switchable Livewire component file.');
}

function getOrderedMultiFileCandidatePaths(
	componentDirectory: string,
	baseName: string,
	currentKind: SwitchableFileKind
): string[] {
	return getOrderedAlternativeKinds(currentKind).map((kind) =>
		path.join(componentDirectory, buildMultiFileFileName(baseName, kind))
	);
}

function getOrderedAlternativeKinds(currentKind: SwitchableFileKind): SwitchableFileKind[] {
	const currentIndex = MULTI_FILE_CYCLE.indexOf(currentKind);
	if (currentIndex === -1) {
		return [];
	}

	const alternatives: SwitchableFileKind[] = [];
	for (let offset = 1; offset < MULTI_FILE_CYCLE.length; offset += 1) {
		alternatives.push(MULTI_FILE_CYCLE[(currentIndex + offset) % MULTI_FILE_CYCLE.length]);
	}

	return alternatives;
}

function buildMultiFileFileName(baseName: string, kind: SwitchableFileKind): string {
	switch (kind) {
		case 'blade':
			return `${baseName}.blade.php`;
		case 'js':
			return `${baseName}.js`;
		case 'test':
			return `${baseName}.test.php`;
		case 'php':
			return `${baseName}.php`;
	}

	return `${baseName}.php`;
}

function describeFile(fileName: string): FileDescriptor {
	if (fileName.endsWith('.blade.php')) {
		return {
			kind: 'blade',
			baseName: fileName.slice(0, -'.blade.php'.length),
		};
	}

	if (fileName.endsWith('.global.css')) {
		return {
			kind: 'auxiliary',
			baseName: fileName.slice(0, -'.global.css'.length),
		};
	}

	if (fileName.endsWith('.test.php')) {
		return {
			kind: 'test',
			baseName: fileName.slice(0, -'.test.php'.length),
		};
	}

	if (fileName.endsWith('.js')) {
		return {
			kind: 'js',
			baseName: fileName.slice(0, -'.js'.length),
		};
	}

	if (fileName.endsWith('.css')) {
		return {
			kind: 'auxiliary',
			baseName: fileName.slice(0, -'.css'.length),
		};
	}

	if (fileName.endsWith('.php')) {
		return {
			kind: 'php',
			baseName: fileName.slice(0, -'.php'.length),
		};
	}

	return {
		kind: 'unsupported',
	};
}

function buildNoop(reason: NoopReason, message: string, searchedPaths?: string[]): SwitchResolution {
	return {
		kind: 'noop',
		reason,
		message,
		searchedPaths,
	};
}

function buildMissingCounterpart(message: string, searchedPaths: string[]): SwitchResolution {
	return buildNoop('missing-counterpart', message, searchedPaths);
}

function normalizeConfiguredPath(workspaceRoot: string, configuredPath: string): string {
	return path.isAbsolute(configuredPath)
		? path.normalize(configuredPath)
		: path.resolve(workspaceRoot, configuredPath);
}

function parsePathListExpression(expression: string | undefined, workspaceRoot: string): string[] {
	if (!expression) {
		return [];
	}

	const body = unwrapArrayExpression(expression);
	if (body === undefined) {
		return [];
	}

	return splitTopLevelEntries(body)
		.map((entry) => parsePathExpression(entry, workspaceRoot))
		.filter((entry): entry is string => Boolean(entry));
}

function parseNamespaceMapExpression(
	expression: string | undefined,
	workspaceRoot: string
): Record<string, string> {
	if (!expression) {
		return {};
	}

	const body = unwrapArrayExpression(expression);
	if (body === undefined) {
		return {};
	}

	return splitTopLevelEntries(body).reduce<Record<string, string>>((result, entry) => {
		const match = entry.match(/^'([^']+)'\s*=>\s*(.+)$/s);
		if (!match) {
			return result;
		}

		const parsedPath = parsePathExpression(match[2], workspaceRoot);
		if (!parsedPath) {
			return result;
		}

		result[match[1]] = parsedPath;
		return result;
	}, {});
}

function parsePathExpression(expression: string | undefined, workspaceRoot: string): string | undefined {
	if (!expression) {
		return undefined;
	}

	const trimmedExpression = expression.trim();
	const stringMatch = trimmedExpression.match(/^'([^']*)'$/s);
	if (stringMatch) {
		return normalizeConfiguredPath(workspaceRoot, stringMatch[1]);
	}

	const helperMatch = trimmedExpression.match(/^(resource_path|app_path|base_path)\(\s*'([^']*)'\s*\)$/s);
	if (!helperMatch) {
		return undefined;
	}

	const [, helper, helperArgument] = helperMatch;
	if (helper === 'resource_path') {
		return path.resolve(workspaceRoot, 'resources', helperArgument);
	}

	if (helper === 'app_path') {
		return path.resolve(workspaceRoot, 'app', helperArgument);
	}

	return path.resolve(workspaceRoot, helperArgument);
}

function unwrapArrayExpression(expression: string): string | undefined {
	const trimmedExpression = expression.trim();
	if (!trimmedExpression.startsWith('[') || !trimmedExpression.endsWith(']')) {
		return undefined;
	}

	return trimmedExpression.slice(1, -1);
}

function splitTopLevelEntries(body: string): string[] {
	const entries: string[] = [];
	let current = '';
	let inSingleQuote = false;
	let parenthesisDepth = 0;
	let bracketDepth = 0;

	for (let index = 0; index < body.length; index += 1) {
		const character = body[index];

		if (inSingleQuote) {
			current += character;
			if (character === '\\' && index + 1 < body.length) {
				current += body[index + 1];
				index += 1;
				continue;
			}

			if (character === '\'') {
				inSingleQuote = false;
			}

			continue;
		}

		if (character === '\'') {
			inSingleQuote = true;
			current += character;
			continue;
		}

		if (character === '(') {
			parenthesisDepth += 1;
			current += character;
			continue;
		}

		if (character === ')') {
			parenthesisDepth = Math.max(0, parenthesisDepth - 1);
			current += character;
			continue;
		}

		if (character === '[') {
			bracketDepth += 1;
			current += character;
			continue;
		}

		if (character === ']') {
			bracketDepth = Math.max(0, bracketDepth - 1);
			current += character;
			continue;
		}

		if (character === ',' && parenthesisDepth === 0 && bracketDepth === 0) {
			const trimmedEntry = current.trim();
			if (trimmedEntry) {
				entries.push(trimmedEntry);
			}
			current = '';
			continue;
		}

		current += character;
	}

	const trimmedEntry = current.trim();
	if (trimmedEntry) {
		entries.push(trimmedEntry);
	}

	return entries;
}

function extractValueExpression(contents: string, key: string): string | undefined {
	const keyMatch = new RegExp(`'${escapeForRegExp(key)}'\\s*=>\\s*`, 'm').exec(contents);
	if (!keyMatch) {
		return undefined;
	}

	let index = keyMatch.index + keyMatch[0].length;
	while (index < contents.length && /\s/.test(contents[index])) {
		index += 1;
	}

	let inSingleQuote = false;
	let parenthesisDepth = 0;
	let bracketDepth = 0;
	const startIndex = index;

	for (; index < contents.length; index += 1) {
		const character = contents[index];

		if (inSingleQuote) {
			if (character === '\\') {
				index += 1;
				continue;
			}

			if (character === '\'') {
				inSingleQuote = false;
			}

			continue;
		}

		if (character === '\'') {
			inSingleQuote = true;
			continue;
		}

		if (character === '(') {
			parenthesisDepth += 1;
			continue;
		}

		if (character === ')') {
			parenthesisDepth = Math.max(0, parenthesisDepth - 1);
			continue;
		}

		if (character === '[') {
			bracketDepth += 1;
			continue;
		}

		if (character === ']') {
			bracketDepth = Math.max(0, bracketDepth - 1);
			continue;
		}

		if (character === ',' && parenthesisDepth === 0 && bracketDepth === 0) {
			return contents.slice(startIndex, index).trim();
		}
	}

	return contents.slice(startIndex).trim();
}

function stripPhpComments(contents: string): string {
	let result = '';
	let inSingleQuote = false;
	let inLineComment = false;
	let inBlockComment = false;

	for (let index = 0; index < contents.length; index += 1) {
		const character = contents[index];
		const nextCharacter = contents[index + 1];

		if (inLineComment) {
			if (character === '\n') {
				inLineComment = false;
				result += '\n';
			} else {
				result += ' ';
			}
			continue;
		}

		if (inBlockComment) {
			if (character === '*' && nextCharacter === '/') {
				inBlockComment = false;
				result += '  ';
				index += 1;
			} else {
				result += character === '\n' ? '\n' : ' ';
			}
			continue;
		}

		if (inSingleQuote) {
			result += character;
			if (character === '\\' && nextCharacter) {
				result += nextCharacter;
				index += 1;
				continue;
			}

			if (character === '\'') {
				inSingleQuote = false;
			}
			continue;
		}

		if (character === '\'') {
			inSingleQuote = true;
			result += character;
			continue;
		}

		if (character === '/' && nextCharacter === '/') {
			inLineComment = true;
			result += '  ';
			index += 1;
			continue;
		}

		if (character === '#') {
			inLineComment = true;
			result += ' ';
			continue;
		}

		if (character === '/' && nextCharacter === '*') {
			inBlockComment = true;
			result += '  ';
			index += 1;
			continue;
		}

		result += character;
	}

	return result;
}

function classRelativePathToBlade(relativeClassPath: string): string {
	const classSegments = relativeClassPath.split(path.sep);
	const normalizedSegments = classSegments.map((segment, index) => {
		const normalizedSegment = index === classSegments.length - 1
			? segment.replace(/\.php$/, '')
			: segment;

		return toKebabCase(normalizedSegment);
	});

	return path.join(...normalizedSegments) + '.blade.php';
}

function bladeRelativePathToClass(relativeBladePath: string): string {
	const normalizedPath = relativeBladePath.replace(/\.blade\.php$/, '');
	const segments = normalizedPath.split(path.sep).map((segment) => toPascalCase(segment));
	return path.join(...segments) + '.php';
}

function toPascalCase(value: string): string {
	return value
		.split(/[-_]/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join('');
}

function toKebabCase(value: string): string {
	return value
		.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
		.replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
		.replace(/_/g, '-')
		.toLowerCase();
}

function findContainingRoot(filePath: string, roots: string[]): string | undefined {
	for (const root of roots) {
		const relativePath = path.relative(root, filePath);
		if (relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))) {
			return root;
		}
	}

	return undefined;
}

function stripEmojiPrefix(value: string): string {
	return value.startsWith('⚡') ? value.slice(1) : value;
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fs.promises.access(filePath, fs.constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

function dedupePaths(paths: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];

	for (const filePath of paths) {
		const normalizedPath = path.resolve(filePath);
		if (seen.has(normalizedPath)) {
			continue;
		}

		seen.add(normalizedPath);
		result.push(normalizedPath);
	}

	return result;
}

function escapeForRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
