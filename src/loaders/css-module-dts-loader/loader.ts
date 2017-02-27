import { createSourceFile, forEachChild, Node, ScriptTarget, SyntaxKind } from 'typescript';
import { statSync } from 'fs';
import { resolve, dirname } from 'path';
const DtsCreator = require('typed-css-modules');
const { getOptions } = require('loader-utils');
const instances = require('ts-loader/dist/instances');

type TSLoaderInstances = {
	files: {
		[key: string]: boolean;
	}
}

type DtsResult = {
	writeFile(): Promise<void>;
}

type DtsCreatorInstance = {
	create(filePath: string, initialContents: boolean, clearCache: boolean): Promise<DtsResult>;
}

type LoaderArgs = {
	type: string;
	instanceName?: string;
}

export type Webpack = {
	resourcePath: string;
	async(): (error: Error | null, result: string, sourceMap?: string) => void;
}

const creator: DtsCreatorInstance = new DtsCreator();

const mTimeMap = new Map<string, Date>();

function generateDTSFile(filePath: string): Promise<void> {
	return Promise.resolve().then(() => {
		const { mtime } = statSync(filePath);
		const lastMTime = mTimeMap.get(filePath);

		if (!lastMTime || mtime > lastMTime) {
			mTimeMap.set(filePath, mtime);
			return creator.create(filePath, false, true)
				.then((content) => content.writeFile());
		}
	});
}

function getCssImport(node: Node): string | void {
	if (node.kind === SyntaxKind.StringLiteral) {
		const importPath = node.getText().replace(/\'|\"/g, '');
		if (/.css$/.test(importPath)) {
			const parentFileName = node.getSourceFile().fileName;
			return resolve(dirname(parentFileName), importPath);
		}
	}
}

function traverseNode(node: Node, filePaths: string[] = []): string[] {
	switch (node.kind) {
		case SyntaxKind.SourceFile:
			forEachChild(node, (childNode: Node) => {
				traverseNode(childNode, filePaths);
			});
			break;
		case SyntaxKind.ImportDeclaration:
			forEachChild(node, (childNode: Node) => {
				const path = getCssImport(childNode);
				path && filePaths.push(path);
			});
			break;
	}
	return filePaths;
}

export default function (this: Webpack, content: string, sourceMap?: string) {
	const callback = this.async();
	const { type = 'ts', instanceName }: LoaderArgs = getOptions(this);

	(<Promise<void | void[]>> Promise.resolve()).then(() => {
		switch (type) {
			case 'css':
				return generateDTSFile(this.resourcePath);
			case 'ts':
				const sourceFile = createSourceFile(this.resourcePath, content, ScriptTarget.Latest, true);
				const cssFilePaths = traverseNode(sourceFile);

				if (cssFilePaths.length) {

					if (instanceName) {
						const instanceWrapper = instances.getTypeScriptInstance({ instance: instanceName });
						instanceWrapper.instance.files[this.resourcePath] = false;
					}

					const generationPromises = cssFilePaths.map((cssFilePath) => generateDTSFile(cssFilePath));
					return Promise.all(generationPromises);
				}
		}
	})
	.then(() => callback(null, content, sourceMap));
}