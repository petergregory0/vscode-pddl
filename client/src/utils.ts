/* --------------------------------------------------------------------------------------------
 * Copyright (c) Jan Dolejsi. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import { ExtensionContext, Uri, workspace, window, Range } from 'vscode';
import * as afs from '../../common/src/asyncfs';
import { PddlExtensionContext } from '../../common/src/PddlExtensionContext';
import { PddlRange } from '../../common/src/DocumentPositionResolver';

export function createPddlExtensionContext(context: ExtensionContext): PddlExtensionContext {
    return {
        asAbsolutePath: context.asAbsolutePath,
        extensionPath: context.extensionPath,
        storagePath: context.storagePath,
        subscriptions: context.subscriptions,
        pythonPath: () => workspace.getConfiguration().get("python.pythonPath", "python")
    };
}

export async function getWebViewHtml(extensionContext: PddlExtensionContext, relativePath: string, htmlFileName: string) {
    let overviewHtmlPath = extensionContext.asAbsolutePath(path.join(relativePath, htmlFileName));
    let html = await afs.readFile(overviewHtmlPath, { encoding: "utf-8", flag: 'r' });

    html = html.replace(/<(script|img|link) ([^>]*)(src|href)="([^"]+)"/g, (sourceElement: string, elementName: string, middleBits: string, attribName: string, attribValue: string) => {
        if (attribValue.startsWith('http')) {
            return sourceElement;
        }
        let resource = Uri.file(
            extensionContext.asAbsolutePath(path.join(relativePath, attribValue)))
            .with({ scheme: "vscode-resource" });
        return `<${elementName} ${middleBits}${attribName}="${resource}"`;
    });

    return html;
}

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

export function firstIndex<T>(array: T[], fn: (t: T) => boolean): number {
    for (let i = 0; i < array.length; i++) {
        if (fn(array[i])) {
            return i;
        }
    }

    return -1;
}

export function compareMaps(map1: Map<string, string>, map2: Map<string, string>) {
    var testVal;
    if (map1.size !== map2.size) {
        return false;
    }
    for (var [key, val] of map1) {
        testVal = map2.get(key);
        // in cases of an undefined value, make sure the key
        // actually exists on the object so there are no false positives
        if (testVal !== val || (testVal === undefined && !map2.has(key))) {
            return false;
        }
    }
    return true;
}

/**
 * Relative fuzzy time in a human readable form.
 * @param time date time
 */
export function toFuzzyRelativeTime(time: number): string {
    var delta = Math.round((+new Date - time) / 1000);

    var minute = 60,
        hour = minute * 60,
        day = hour * 24;

    var fuzzy;

    if (delta < 30) {
        fuzzy = 'just now';
    } else if (delta < minute) {
        fuzzy = delta + ' seconds ago';
    } else if (delta < 2 * minute) {
        fuzzy = 'a minute ago';
    } else if (delta < hour) {
        fuzzy = Math.floor(delta / minute) + ' minutes ago';
    } else if (Math.floor(delta / hour) === 1) {
        fuzzy = '1 hour ago';
    } else if (delta < day) {
        fuzzy = Math.floor(delta / hour) + ' hours ago';
    } else if (delta < day * 2) {
        fuzzy = 'yesterday';
    }
    else {
        fuzzy = Math.floor(delta / day) + ' days ago';
    }

    return fuzzy;
}

export function showError(reason: any): void {
    console.log(reason);
    window.showErrorMessage(reason.message);
}

/**
 * Absolute path, unless it relied on a %path% location (i.e. there was no dirname). 
 * @param configuredPath a configured path to an executable
 */
export function ensureAbsolutePath(configuredPath: string, context: ExtensionContext): string {
    if (isHttp(configuredPath)) {
        return configuredPath;
    }

    // if the path is absolute, or contains just the name of an executable (obviously relying on the %path&), return it as is
    if (!configuredPath) {
        return configuredPath;
    } 
    else if (path.isAbsolute(configuredPath) || !path.dirname(configuredPath)) {
        return configuredPath;
    }
    else {
        return context.asAbsolutePath(configuredPath);
    }
}

export function isHttp(path: string): boolean {
    return path.match(/^http[s]?:/i) !== null;
}

export function equalsCaseInsensitive(text1: string, text2: string): boolean {
    return text1.toLowerCase() === text2.toLowerCase();
}

export function toRange(pddlRange: PddlRange): Range {
	return new Range(pddlRange.startLine, pddlRange.startCharacter, pddlRange.endLine, pddlRange.endCharacter);
}
