/* --------------------------------------------------------------------------------------------
 * Copyright (c) Jan Dolejsi. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import {
    window, ExtensionContext, Uri, ViewColumn, WebviewPanel, commands, workspace, ConfigurationTarget
} from 'vscode';

import { PddlConfiguration } from '../configuration';

import * as path from 'path';

import * as fs from 'fs';
import { getWebViewHtml, writeFile, readFile } from '../utils';

export const SHOULD_SHOW_OVERVIEW_PAGE = 'shouldShowOverviewPage';
export const LAST_SHOWN_OVERVIEW_PAGE = 'lastShownOverviewPage';

export class OverviewPage {

    private webViewPanel: WebviewPanel

    constructor(private context: ExtensionContext, private pddlConfiguration: PddlConfiguration) {
        commands.registerCommand("pddl.showOverview", () => this.showWelcomePage(true));
        workspace.onDidChangeConfiguration(_ => this.updatePageConfiguration(), undefined, this.context.subscriptions);
    }

    async showWelcomePage(showAnyway: boolean): Promise<void> {
        if (this.webViewPanel) {
            this.webViewPanel.reveal();
        }
        else {
            if (showAnyway || this.beenAWhile()) {
                this.createWelcomePage(false);
            }
        }
    }

    beenAWhile(): boolean {
        let lastTimeShown = this.context.globalState.get<string>(LAST_SHOWN_OVERVIEW_PAGE, new Date(2000, 0, 1).toString());
        let minutesSinceLastShow = (Date.now() - Date.parse(lastTimeShown)) / 1000 / 60;
        return minutesSinceLastShow > 60;
    }

    async createWelcomePage(showOnTop: boolean): Promise<void> {
        let html = await this.getHtml();
        let iconUri = this.context.asAbsolutePath('images/icon.png');

        this.webViewPanel = window.createWebviewPanel(
            "pddl.Wecome",
            "PDDL Overview",
            {
                viewColumn: ViewColumn.Active,
                preserveFocus: !showOnTop
            },
            {
                retainContextWhenHidden: true,
                enableFindWidget: true,
                enableCommandUris: true,
                enableScripts: true,
                localResourceRoots: [Uri.file(path.join(this.context.extensionPath, this.CONTENT_FOLDER))]
            }
        );

        this.webViewPanel.webview.html = html;
        this.webViewPanel.iconPath = Uri.file(iconUri);

        this.webViewPanel.onDidDispose(() => this.webViewPanel = undefined, undefined, this.context.subscriptions);
        this.webViewPanel.webview.onDidReceiveMessage(message => this.handleMessage(message), undefined, this.context.subscriptions);
        this.webViewPanel.onDidChangeViewState(_ => this.updatePageConfiguration());

        this.context.subscriptions.push(this.webViewPanel);

        // set up the view with relevant data
        this.updatePageConfiguration();

        // record the last date the page was shown on top
        this.context.globalState.update(LAST_SHOWN_OVERVIEW_PAGE, new Date(Date.now()));
    }

    async handleMessage(message: any): Promise<void> {
        console.log(`Message received from the webview: ${message.command}`);

        switch(message.command){
            case 'shouldShowOverview':
                this.context.globalState.update(SHOULD_SHOW_OVERVIEW_PAGE, message.value);
                break;
            case 'tryHelloWorld':
                try {
                    await this.helloWorld();
                }
                catch(ex){
                    window.showErrorMessage(ex);
                }
                break;
            case 'clonePddlSamples':
                commands.executeCommand("git.clone", Uri.parse("https://github.com/jan-dolejsi/vscode-pddl-samples"));
                break;
            case 'plannerOutputTarget':
                workspace.getConfiguration("pddlPlanner").update("executionTarget", message.value, ConfigurationTarget.Global);
                break;
            default:
                console.warn('Unexpected command: ' + message.command);
        }
    }

    CONTENT_FOLDER = "overview";

    async helloWorld(): Promise<void> {
        let folder: Uri = undefined;

        if (workspace.workspaceFolders.length == 0) {
            let folders = await window.showOpenDialog({canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Select folder for hello world...'});
            if (folders) {
                folder = folders[0];
            }
        } else if (workspace.workspaceFolders.length == 1) {
            folder = workspace.workspaceFolders[0].uri;
        } else {
            let selectedFolder = await window.showWorkspaceFolderPick({placeHolder: 'Select workspace folder for Hello World!'});
            folder = selectedFolder.uri;
        }

        let domainResourcePath = this.context.asAbsolutePath('overview/domain.pddl');
        let domainText = await readFile(domainResourcePath, { encoding: "utf-8" });
        let domainPath = path.join(folder.fsPath, "domain.pddl");
        if (fs.existsSync(domainPath)) throw new Error("File 'domain.pddl' already exists.");
        await writeFile(domainPath, domainText, {encoding: "utf-8"});
        let domainDocument = await workspace.openTextDocument(domainPath);
        await window.showTextDocument(domainDocument, {viewColumn: ViewColumn.One, preview: false});

        let problemResourcePath = this.context.asAbsolutePath('overview/problem.pddl');
        let problemText = await readFile(problemResourcePath, { encoding: "utf-8" });
        let problemPath = path.join(folder.fsPath, "problem.pddl");
        if (fs.existsSync(problemPath)) throw new Error("File 'problem.pddl' already exists.");
        await writeFile(problemPath, problemText, {encoding: "utf-8"});
        let problemDocument = await workspace.openTextDocument(problemPath);
        window.showTextDocument(problemDocument, {viewColumn: ViewColumn.Two, preview: false});

        commands.executeCommand("pddl.planAndDisplayResult", domainDocument.uri, problemDocument.uri, folder.fsPath, "");
    }

    async getHtml(): Promise<string> {
        let html = getWebViewHtml(this.context, this.CONTENT_FOLDER, 'overview.html');
        return html;
    }

    async updatePageConfiguration(): Promise<void> {
        if (!this.webViewPanel) return;
        let message = {
            command: 'updateConfiguration',
            planner: await this.pddlConfiguration.getPlannerPath(),
            plannerOutputTarget: await workspace.getConfiguration("pddlPlanner").get<String>("executionTarget"),
            parser: await this.pddlConfiguration.getParserPath(),
            validator: await this.pddlConfiguration.getValidatorPath(),
            shouldShow: this.context.globalState.get<boolean>(SHOULD_SHOW_OVERVIEW_PAGE, true),
            autoSave: workspace.getConfiguration().get<String>("files.autoSave")
        };
        this.webViewPanel.webview.postMessage(message);
    }
}