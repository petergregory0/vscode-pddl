/* --------------------------------------------------------------------------------------------
 * Copyright (c) Jan Dolejsi. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import {
    window, workspace, commands, OutputChannel, Uri,
    MessageItem, ExtensionContext, ProgressLocation, TextDocument, EventEmitter, Event, CancellationToken, Progress
} from 'vscode';

import * as path from 'path';

import { PddlWorkspace } from '../../../common/src/workspace-model';
import { DomainInfo, ProblemInfo } from '../../../common/src/parser';
import { FileInfo, PddlLanguage } from '../../../common/src/FileInfo';
import { PddlConfiguration } from '../configuration';
import { Plan } from '../../../common/src/Plan';
import { PlannerResponseHandler } from './PlannerResponseHandler';
import { PlannerExecutable } from './PlannerExecutable';
import { PlannerService } from './PlannerService';
import { Planner } from './planner';
import { PddlPlanParser } from '../../../common/src/PddlPlanParser';
import { Authentication } from '../../../common/src/Authentication';
import { dirname } from 'path';
import { PlanningResult } from './PlanningResult';
import { PlanReportGenerator } from './PlanReportGenerator';
import { PlanExporter } from './PlanExporter';
import { PlanHappeningsExporter } from './PlanHappeningsExporter';
import { HappeningsPlanExporter } from './HappeningsPlanExporter';
import { isHappenings, isPlan, exists } from '../utils';
import { PlanView, PDDL_GENERATE_PLAN_REPORT, PDDL_EXPORT_PLAN } from './PlanView';

const PDDL_STOP_PLANNER = 'pddl.stopPlanner';
const PDDL_CONVERT_PLAN_TO_HAPPENINGS = 'pddl.convertPlanToHappenings';
const PDDL_CONVERT_HAPPENINGS_TO_PLAN = 'pddl.convertHappeningsToPlan';

/**
 * Delegate for handling requests to run the planner and visualize the plans.
 */
export class Planning implements PlannerResponseHandler {
    output: OutputChannel;
    epsilon = 1e-3;

    planner: Planner;
    plans: Plan[];
    planningProcessKilled: boolean;
    planView: PlanView;

    constructor(public pddlWorkspace: PddlWorkspace, public plannerConfiguration: PddlConfiguration, context: ExtensionContext) {
        this.output = window.createOutputChannel("Planner output");

        context.subscriptions.push(this.planView = new PlanView(context, pddlWorkspace));

        context.subscriptions.push(commands.registerCommand('pddl.planAndDisplayResult',
            async (domainUri: Uri, problemUri: Uri, workingFolder: string, options: string) => {
                if (problemUri) {
                    await this.planByUri(domainUri, problemUri, workingFolder, options);
                } else {
                    await this.plan();
                }
            })
        );

        context.subscriptions.push(commands.registerCommand(PDDL_STOP_PLANNER, () => this.stopPlanner()));

        context.subscriptions.push(commands.registerCommand(PDDL_GENERATE_PLAN_REPORT, (plans: Plan[], selectedPlan: number) => {
            if (plans != null) {
                new PlanReportGenerator(context, 1000, true).export(plans, selectedPlan);
            } else {
                window.showErrorMessage("There is no plan to export.");
            }
        }));

        context.subscriptions.push(commands.registerCommand(PDDL_EXPORT_PLAN, (plan: Plan) => {
            if (plan) {
                new PlanExporter(plan).export();
            } else {
                window.showErrorMessage("There is no plan open, or the selected plan does not exist.");
            }
        }));

        context.subscriptions.push(commands.registerCommand(PDDL_CONVERT_PLAN_TO_HAPPENINGS, async () => {
            if (window.activeTextEditor && isPlan(window.activeTextEditor.document)) {
                let epsilon = plannerConfiguration.getEpsilonTimeStep();
                new PlanHappeningsExporter(window.activeTextEditor.document, epsilon).export();
            } else {
                window.showErrorMessage("Active document is not a plan.");
            }
        }));

        context.subscriptions.push(commands.registerCommand(PDDL_CONVERT_HAPPENINGS_TO_PLAN, async () => {
            if (window.activeTextEditor && isHappenings(window.activeTextEditor.document)) {
                let epsilon = plannerConfiguration.getEpsilonTimeStep();
                new HappeningsPlanExporter(window.activeTextEditor.document, epsilon).export();
            } else {
                window.showErrorMessage("Active document is not a happening.");
            }
        }));
    }

    /**
     * Invokes the planner in context of model specified via file URIs.
     * @param domainUri domain file uri
     * @param problemUri problem file uri
     * @param workingFolder working folder
     * @param options planner options
     */
    async planByUri(domainUri: Uri, problemUri: Uri, workingFolder: string, options?: string): Promise<void> {
        let domainDocument = await workspace.openTextDocument(domainUri);
        let problemDocument = await workspace.openTextDocument(problemUri);

        let domainInfo = <DomainInfo>this.upsertFile(domainDocument);
        let problemInfo = <ProblemInfo>this.upsertFile(problemDocument);

        this.planExplicit(domainInfo, problemInfo, workingFolder, options);
    }

    private upsertFile(doc: TextDocument): FileInfo {
        return this.pddlWorkspace.upsertAndParseFile(doc.uri.toString(), PddlLanguage.PDDL, doc.version, doc.getText());
    }

    /**
     * Invokes the planner in the context of the currently opened files in the workspace.
     */
    async plan(): Promise<void> {

        if (this.planner) {
            window.showErrorMessage("Planner is already running. Stop it using the Cancel button in the progress notification, or using the PDDL: Stop planner command or wait for it to finish.");
            return;
        }

        this.output.clear();

        const activeDocument = window.activeTextEditor.document;
        const activeFilePath = activeDocument.fileName;

        const activeFileInfo = this.upsertFile(activeDocument);

        let problemFileInfo: ProblemInfo;
        let domainFileInfo: DomainInfo;

        if (activeFileInfo.isProblem()) {
            problemFileInfo = <ProblemInfo>activeFileInfo;

            let folder = this.pddlWorkspace.getFolderOf(problemFileInfo);

            // find domain files in the same folder that match the problem's domain name
            let domainFiles = folder.getDomainFilesFor(problemFileInfo);

            if (domainFiles.length == 1) {
                domainFileInfo = domainFiles[0];
            } else if (domainFiles.length > 1) {
                const domainFileCandidates = domainFiles
                    .map(doc => Planning.getFileName(doc.fileUri.toString()));

                const domainFileName = await window.showQuickPick(domainFileCandidates, { placeHolder: "Select domain file:" });

                if (!domainFileName) return; // was canceled

                const domainFilePath = path.join(dirname(activeFilePath), domainFileName);
                let domainFileUri = Uri.file(domainFilePath);

                domainFileInfo = domainFiles.find(doc => doc.fileUri == domainFileUri.toString());
            } else {
                window.showInformationMessage(`Ensure a domain '${problemFileInfo.domainName}' from the same folder is open in the editor.`);
                return;
            }
        }
        else if (activeFileInfo.isDomain()) {
            domainFileInfo = <DomainInfo>activeFileInfo;

            let problemFiles = this.pddlWorkspace.getProblemFiles(domainFileInfo);

            if (problemFiles.length == 1) {
                problemFileInfo = problemFiles[0];
            } else if (problemFiles.length > 1) {
                const problemFileNames = problemFiles.map(info => Planning.getFileName(info.fileUri));

                const selectedProblemFileName = await window.showQuickPick(problemFileNames, { placeHolder: "Select problem file:" });

                if (!selectedProblemFileName) return; // was canceled

                problemFileInfo = problemFiles.find(fileInfo => fileInfo.fileUri.endsWith('/' + selectedProblemFileName));
            } else {
                window.showInformationMessage("Ensure a corresponding problem file is open in the editor.");
                return;
            }
        }
        else {
            window.showInformationMessage("Selected file does not appear to be a valid PDDL domain or problem file.");
            return;
        }

        this.planExplicit(domainFileInfo, problemFileInfo, dirname(activeDocument.fileName));
    }

    private readonly _onPlansFound = new EventEmitter<PlanningResult>();
    public onPlansFound: Event<PlanningResult> = this._onPlansFound.event;
    private progressUpdater: ElapsedTimeProgressUpdater;

    /**
     * Invokes the planner and visualize the plan(s).
     * @param domainFileInfo domain
     * @param problemFileInfo problem
     * @param workingDirectory workflow folder for auxiliary output files
     * @param options planner options
     */
    async planExplicit(domainFileInfo: DomainInfo, problemFileInfo: ProblemInfo, workingDirectory: string, options?: string): Promise<void> {

        let planParser = new PddlPlanParser(domainFileInfo, problemFileInfo, this.plannerConfiguration.getEpsilonTimeStep(), plans => this.visualizePlans(plans));

        workingDirectory = await this.adjustWorkingFolder(workingDirectory);

        this.planner = await this.createPlanner(workingDirectory, options);
        if (!this.planner) return;

        this.planningProcessKilled = false;

        window.withProgress<Plan[]>({
            location: ProgressLocation.Notification,
            title: `Searching for plans for domain ${domainFileInfo.name} and problem ${problemFileInfo.name}`,
            cancellable: true,

        }, (progress, token) => {
            token.onCancellationRequested(() => {
                this.planningProcessKilled = true;
                this.stopPlanner();
            });

            this.progressUpdater = new ElapsedTimeProgressUpdater(progress, token);
            return this.planner.plan(domainFileInfo, problemFileInfo, planParser, this);
        })
            .then(plans => this.onPlannerFinished(plans), reason => this.onPlannerFailed(reason));

        this.output.show(true);
    }

    onPlannerFinished(plans: Plan[]): void {
        let elapsedTime = this.progressUpdater.getElapsedTimeInMilliSecs();
        this.progressUpdater.setFinished();
        let result = this.planningProcessKilled ? PlanningResult.killed() : PlanningResult.success(plans, elapsedTime);
        this._onPlansFound.fire(result);
        this.planner = null;

        this.output.appendLine(`Planner found ${plans.length} plan(s) in ${this.progressUpdater.getElapsedTimeInMilliSecs() / 1000}secs.`);
        this.visualizePlans(plans);
    }

    onPlannerFailed(reason: any): void {
        this.progressUpdater.setFinished();
        this._onPlansFound.fire(PlanningResult.failure(reason.toString()));

        this.planner = null;
        console.error(reason);

        window.showErrorMessage<ProcessErrorMessageItem>(reason.message,
            { title: "Re-configure the planner", setPlanner: true },
            { title: "Ignore", setPlanner: false, isCloseAffordance: true }
        ).then(selection => {
            if (selection && selection.setPlanner) {
                this.plannerConfiguration.askNewPlannerPath();
            }
        });
    }

    async adjustWorkingFolder(workingDirectory: string): Promise<string> {
        // the working directory may be virtual, replace it
        if (!await exists(workingDirectory)) {
            if (workspace.workspaceFolders.length) {
                return workspace.workspaceFolders[0].uri.fsPath;
            }
            else {
                return "";
            }
        }
        else {
            return workingDirectory;
        }
    }

    getPlans(): Plan[] {
        return this.plans;
    }

    /**
     * Creates the right planner wrapper according to the current configuration.
     *
     * @param workingDirectory directory where planner creates output files by default
     * @param options planner options
     * @returns `Planner` instance of the configured planning engine
     */
    async createPlanner(workingDirectory: string, options?: string): Promise<Planner> {
        let plannerPath = await this.plannerConfiguration.getPlannerPath();
        if (!plannerPath) return null;

        if (!await this.verifyConsentForSendingPddl(plannerPath)) return null;

        let plannerOptions = options != undefined ? options : await this.plannerConfiguration.getPlannerOptions();
        if (plannerOptions == null) return null;

        if (PddlConfiguration.isHttp(plannerPath)) {
            let useAuthentication = this.plannerConfiguration.isPddlPlannerServiceAuthenticationEnabled();
            let authentication = null;
            if (useAuthentication) {
                let configuration = this.plannerConfiguration.getPddlPlannerServiceAuthenticationConfiguration()
                authentication = new Authentication(configuration.url, configuration.requestEncoded, configuration.clientId, configuration.callbackPort, configuration.timeoutInMs,
                    configuration.tokensvcUrl, configuration.tokensvcApiKey, configuration.tokensvcAccessPath, configuration.tokensvcValidatePath,
                    configuration.tokensvcCodePath, configuration.tokensvcRefreshPath, configuration.tokensvcSvctkPath,
                    configuration.refreshToken, configuration.accessToken, configuration.sToken);
            }
            return new PlannerService(plannerPath, plannerOptions, useAuthentication, authentication);
        }
        else {
            let plannerSyntax = await this.plannerConfiguration.getPlannerSyntax();
            if (plannerSyntax == null) return null;

            return new PlannerExecutable(plannerPath, plannerOptions, plannerSyntax, workingDirectory);
        }
    }

    PLANNING_SERVICE_CONSENTS = "planningServiceConsents";

    async verifyConsentForSendingPddl(plannerPath: string): Promise<boolean> {
        if (PddlConfiguration.isHttp(plannerPath)) {
            let consents: any = this.plannerConfiguration.context.globalState.get(this.PLANNING_SERVICE_CONSENTS, {});
            if (consents[plannerPath]) {
                return true;
            }
            else {
                let answer = await window.showQuickPick(
                    [
                        "Yes, send my PDDL to this service.",
                        "No, I do not want to send this PDDL to this service."
                    ],
                    {
                        canPickMany: false,
                        placeHolder: "Confirm you want to send this PDDL to " + plannerPath
                    }
                );
                let consentGiven = answer && answer.toLowerCase().startsWith("yes");
                consents[plannerPath] = consentGiven;
                this.plannerConfiguration.context.globalState.update(this.PLANNING_SERVICE_CONSENTS, consents);
                return consentGiven;
            }
        }
        else {
            return true;
        }
    }

    stopPlanner() {
        try {
            if (this.planner) {
                this.planner.stop();

                this.planner = null;
                this.output.appendLine('Process killing requested.');
            }
        }
        catch (ex) {
            console.error(ex);
        }
    }

    handleOutput(outputText: string): void {
        this.output.append(outputText);
    }

    handlePlan(_plan: Plan): void {
        // todo: this shall be implemented, when the planning service can return multiple plans
        throw new Error("Method not implemented.");
    }

    visualizePlans(plans: Plan[]): void {
        this.plans = plans;
        this.planView.setPlannerOutput(plans);
    }

    // copied from the Workspace class
    static getFileName(documentUri: string): string {
        let lastSlashIdx = documentUri.lastIndexOf("/");
        return documentUri.substring(lastSlashIdx + 1);
    }
    static q(path: string): string {
        return path.includes(' ') ? `"${path}"` : path;
    }
}

class ProcessErrorMessageItem implements MessageItem {
    title: string;
    isCloseAffordance?: boolean;
    setPlanner: boolean;
}

class ElapsedTimeProgressUpdater {
    startTime = new Date();
    finished: boolean;

    constructor(private progress: Progress<{ message?: string; increment?: number }>,
        private token: CancellationToken) {
        this.reportProgress();
    }

    getElapsedTimeInMilliSecs(): number {
        return new Date().getTime() - this.startTime.getTime();
    }

    reportProgress(): void {
        if (this.token.isCancellationRequested || this.finished) return;
        setTimeout(() => {
            var elapsedTime = new Date(this.getElapsedTimeInMilliSecs());
            this.progress.report({ message: "Elapsed time: " + elapsedTime.toISOString().substr(11, 8) });
            this.reportProgress();
        }, 1000);
    }

    setFinished(): void {
        this.finished = true;
    }
}