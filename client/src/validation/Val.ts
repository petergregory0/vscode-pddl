/* --------------------------------------------------------------------------------------------
 * Copyright (c) Jan Dolejsi. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { commands, ExtensionContext, window, ProgressLocation, workspace, ConfigurationTarget } from 'vscode';
import * as path from 'path';
import { getFile } from '../httpUtils';
import * as afs from '../../../common/src/asyncfs';
import * as fs from 'fs';
import * as os from 'os';
import * as AdmZip from 'adm-zip';
import { PARSER_EXECUTABLE_OR_SERVICE, CONF_PDDL, VALIDATION_PATH, VALUE_SEQ_PATH, VAL_STEP_PATH } from '../configuration';
import { VAL_DOWNLOAD_COMMAND, ValDownloadOptions } from './valCommand';

export class Val {
    /** Directory where VAL binaries are to be downloaded locally. */
    static readonly VAL_DIR = "val";
    /** File that contains version info of last downloaded VAL binaries. */
    valVersionPath: string;

    constructor(private context: ExtensionContext) {
        context.subscriptions.push(commands.registerCommand(VAL_DOWNLOAD_COMMAND, async (options: ValDownloadOptions) => {
            try {
                let userAgreesToDownload = (options && options.bypassConsent) || await this.promptForConsent();
                if (!userAgreesToDownload) { return; }
                await this.downloadConfigureAndCleanUp();
            } catch (ex) {
                window.showErrorMessage(ex.message || ex);
            }
        }));

        this.valVersionPath = path.join(this.getValPath(), "VAL.version");
    }

    /** Directory where VAL binaries are to be downloaded locally. */
    getValPath(): string {
        return path.join(this.context.extensionPath, Val.VAL_DIR);
    }

    private async promptForConsent(): Promise<boolean> {
        let download = "Download";
        let answer = await window.showInformationMessage("Please confirm to download [build](https://dev.azure.com/schlumberger/ai-planning-validation) of [VAL tools](https://github.com/KCL-Planning/VAL)...", download, "Cancel");
        return answer === download;
    }

    async downloadConfigureAndCleanUp(): Promise<void> {
        let wasValInstalled = await this.isInstalled();
        let previousVersion: ValVersion = wasValInstalled ? await this.readVersion() : null;
        let newVersion: ValVersion;
        try {

            await this.downloadAndConfigure();
            newVersion = await this.readVersion();
        }
        finally {
            // clean previous version
            if (wasValInstalled && previousVersion && newVersion) {
                if (previousVersion.buildId !== newVersion.buildId) {
                    console.log(`The ${previousVersion.version} and the ${newVersion.version} differ, cleaning-up the old version.`);
                    let filesAbsPaths = previousVersion.files.map(f => path.join(this.context.extensionPath, f));
                    await this.deleteAll(filesAbsPaths);
                }
            }
        }
    }

    private getLatestStableValBuildId(): number {
        return workspace.getConfiguration().get<number>("pddl.validatorVersion");
    }

    private async downloadAndConfigure(): Promise<void> {

        let buildId = this.getLatestStableValBuildId();
        let artifactName = Val.getArtifactName();
        if (!artifactName) {
            this.unsupportedOperatingSystem();
            return;
        }

        let zipPath = path.join(this.getValPath(), "drop.zip");
        await afs.mkdirIfDoesNotExist(path.dirname(zipPath), 0o644);

        let url = `https://dev.azure.com/schlumberger/4e6bcb11-cd68-40fe-98a2-e3777bfec0a6/_apis/build/builds/${buildId}/artifacts?artifactName=${artifactName}&api-version=5.2-preview.5&%24format=zip`;

        await window.withProgress({ location: ProgressLocation.Window, title: 'Downloading VAL tools...' }, (_progress, _token) => {
            return getFile(url, zipPath);
        });
        console.log("Done downloading." + url);

        let dropEntries = await this.unzip(zipPath);

        let zipEntries = dropEntries
            .filter(entry => entry.endsWith('.zip'));

        if (zipEntries.length !== 1) {
            throw new Error(`Binary archive contains unexpected number of zip entries: ${zipEntries.length}. Content: ${dropEntries}`);
        }

        let valZipFileName = zipEntries[0];

        let versionMatch = /^Val-(\d{8}\.\d+(\.DRAFT)?(-Linux)?)/.exec(path.basename(valZipFileName));
        if (!versionMatch) {
            throw new Error("Binary archive version does not conform to the expected pattern: " + valZipFileName);
        }

        let version = versionMatch[1];

        let valToolFileNames = await this.decompress(path.join(this.getValPath(), valZipFileName));

        // clean-up and delete the drop content
        await this.deleteAll(dropEntries.map(file => path.join(this.getValPath(), file)));

        // delete the drop zip
        await afs.unlink(zipPath);

        let wasValInstalled = await this.isInstalled();
        let previousVersion = wasValInstalled ? await this.readVersion() : null;

        let valToolFileRelativePaths = valToolFileNames.map(fileName => path.join(Val.VAL_DIR, fileName));
        let newValVersion = { buildId: buildId, version: version, files: valToolFileRelativePaths };

        await this.writeVersion(newValVersion);

        await this.updateConfigurationPaths(newValVersion, previousVersion);
    }

    async decompress(compressedFilePath: string): Promise<string[]> {
        if (compressedFilePath.endsWith(".zip")) {
            return this.unzip(compressedFilePath);
        }
        else {
            throw new Error(`VAL tools were downloaded to ${compressedFilePath}, and must be de-compressed and configured manually.`);
        }
    }

    async unzip(zipPath: string): Promise<string[]> {
        let zip = new AdmZip(zipPath);
        let entryNames = zip.getEntries()
            .filter(entry => !entry.isDirectory)
            .map(entry => entry.entryName);

        return new Promise<string[]>((resolve, reject) => {
            zip.extractAllToAsync(this.getValPath(), true, err => {
                if (err) {
                    reject(err);
                    return;
                }
                else {
                    resolve(entryNames);
                }
            });
        });
    }

    private async deleteAll(files: string[]): Promise<void> {
        // 1. delete downloaded files
        let deletionPromises = files
            .filter(file => fs.existsSync(file))
            .map(async file => await afs.unlink(file));
        await Promise.all(deletionPromises);

        // 2. delete empty directories
        let directories = [...new Set(files.map(file => path.dirname(file)))];
        let emptyDirectories = directories
            // sorted from longest to shortest to delete sub-directories first
            .sort((a, b) => b.length - a.length);

        for (const directory of emptyDirectories) {
            if (await afs.isEmpty(directory)) {
                await afs.rmdir(directory);
            }
        }
    }

    async isInstalled(): Promise<boolean> {
        return await afs.exists(this.valVersionPath);
    }

    private async readVersion(): Promise<ValVersion> {
        try {
            let versionAsString = await afs.readFile(this.valVersionPath, { encoding: 'utf8' });
            var versionAsJson = JSON.parse(versionAsString);
            return versionAsJson;
        }
        catch (err) {
            throw new Error(`Error reading VAL version ${err.name}: ${err.message}`);
        }
    }

    private async writeVersion(valVersion: ValVersion): Promise<void> {
        var json = JSON.stringify(valVersion, null, 2);
        try {
            await afs.writeFile(this.valVersionPath, json, 'utf8');
        }
        catch (err) {
            throw new Error(`Error saving VAL version ${err.name}: ${err.message}`);
        }
    }

    static getArtifactName(): string {
        switch (os.platform()) {
            case "win32":
                switch (os.arch()) {
                    case "x64":
                        return "win64";
                    case "x32":
                        return "win32";
                    default:
                        return null;
                }
                break;
            case "linux":
                switch (os.arch()) {
                    case "x64":
                        return "linux64";
                    default:
                        return null;
                }
            case "darwin":
                switch (os.arch()) {
                    case "x64":
                        return "macos64";
                    default:
                        return null;
                }
            default:
                return null;
        }
    }

    private unsupportedOperatingSystem() {
        window.showInformationMessage(`[VAL](https://github.com/KCL-Planning/VAL "VAL tools repository hosted by Kings College London Planning department.") binaries are not available for the ${os.platform()} platform.\nVisit the repository, build it on your system and manually configure it in VS Code settings.`);
    }

    /**
     * Configures the val tool paths
     * @param newValVersion val version just downloaded
     * @param oldValVersion val version from which we are upgrading
     */
    private async updateConfigurationPaths(newValVersion: ValVersion, oldValVersion: ValVersion): Promise<void> {
        let fileToConfig = new Map<string, string>();
        fileToConfig.set("Parser", PARSER_EXECUTABLE_OR_SERVICE);
        fileToConfig.set("Validate", CONF_PDDL + '.' + VALIDATION_PATH);
        fileToConfig.set("ValueSeq", CONF_PDDL + '.' + VALUE_SEQ_PATH);
        fileToConfig.set("ValStep", CONF_PDDL + '.' + VAL_STEP_PATH);

        for (const toolName of fileToConfig.keys()) {
            let oldToolPath = findValToolPath(oldValVersion, toolName);
            let newToolPath = findValToolPath(newValVersion, toolName);

            let configKey = fileToConfig.get(toolName);

            this.updateConfigurationPath(configKey, newToolPath, oldToolPath);
        }
    }

    /**
     * Updates the configuration path for the configuration key, unless it was explicitly set by the user.
     * @param configKey configuration key in the form prefix.postfix
     * @param newToolPath the location of the currently downloaded/unzipped tool
     * @param oldToolPath the location of the previously downloaded/unzipped tool
     */
    private async updateConfigurationPath(configKey: string, newToolPath: string, oldToolPath: string): Promise<void> {
        let oldValue = workspace.getConfiguration().inspect(configKey);
        if (!oldValue) {
            console.log("configuration not declared: " + configKey);
            return;
        }
        let configuredGlobalValue: string = <string>oldValue.globalValue;
        let normConfiguredGlobalValue = this.normalizePathIfValid(configuredGlobalValue);

        let normOldToolPath = this.normalizePathIfValid(oldToolPath);

        // was the oldValue empty, or did it match the oldToolPath? Overwrite it!
        if (configuredGlobalValue === null || configuredGlobalValue === undefined || normConfiguredGlobalValue === normOldToolPath) {
            await workspace.getConfiguration().update(configKey, newToolPath, ConfigurationTarget.Global);
        }
    }

    private normalizePathIfValid(pathToNormalize: string): string {
        return pathToNormalize ? path.normalize(pathToNormalize) : pathToNormalize;
    }

    async isNewValVersionAvailable(): Promise<boolean> {
        let isInstalled = await this.isInstalled();
        if (!isInstalled) { return false; }

        let latestStableValBuildId = this.getLatestStableValBuildId();
        let installedVersion = await this.readVersion();

        return latestStableValBuildId > installedVersion.buildId;
    }
}

interface ValVersion {
    readonly buildId: number;
    readonly version: string;
    readonly files: string[];
}

/**
 * Finds the path of given VAL tool in the given version.
 * @param valVersion VAL version manifest
 * @param toolName tool name for which we are looking for its path
 * @returns corresponding path, or _undefined_ if the _valVersion_ argument is null or undefined
 */
function findValToolPath(valVersion: ValVersion, toolName: string): string {
    if (!valVersion) { return undefined; }
    let pattern = new RegExp("\\b" + toolName + "(?:\\.exe)?$");
    return valVersion.files.find(filePath => pattern.test(filePath));
}