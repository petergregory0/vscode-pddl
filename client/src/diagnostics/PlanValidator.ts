/* --------------------------------------------------------------------------------------------
 * Copyright (c) Jan Dolejsi. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import {
    window, commands, OutputChannel, ExtensionContext, TextDocument, Diagnostic, Uri, Range, DiagnosticSeverity, workspace
} from 'vscode';

import * as process from 'child_process';

import { PlanInfo, ProblemInfo } from '../../../common/src/parser';
import { DomainInfo } from '../../../common/src/DomainInfo';
import { ParsingProblem } from '../../../common/src/FileInfo';
import { PddlConfiguration } from '../configuration';
import { Util } from '../../../common/src/util';
import { dirname } from 'path';
import { PlanStep } from '../../../common/src/PlanStep';
import { DomainAndProblem, getDomainAndProblemForPlan, isPlan, NoProblemAssociated, NoDomainAssociated } from '../workspace/workspaceUtils';
import { showError } from '../utils';
import { VAL_DOWNLOAD_COMMAND } from '../validation/valCommand';
import { CodePddlWorkspace } from '../workspace/CodePddlWorkspace';

export const PDDL_PLAN_VALIDATE = 'pddl.plan.validate';

/**
 * Delegate for parsing and validating plans..
 */
export class PlanValidator {

    constructor(private output: OutputChannel, public codePddlWorkspace: CodePddlWorkspace, public plannerConfiguration: PddlConfiguration, context: ExtensionContext) {

        context.subscriptions.push(commands.registerCommand(PDDL_PLAN_VALIDATE,
            async (planUri: Uri) => this.validateActiveDocument(planUri).catch(showError)));
    }

    async validateActiveDocument(planUri?: Uri): Promise<void> {

        var planDocument: TextDocument;
        if (!planUri && window.activeTextEditor) {
            planDocument = window.activeTextEditor.document;
        } else {
            planDocument = await workspace.openTextDocument(planUri);
        }

        if (!isPlan(planDocument)) { return; }

        if (planDocument) {
            if (!await this.testConfiguration()) { return; }
            try {
                let outcome = await this.validatePlanDocument(planDocument);
                if (outcome.getError()) {
                    commands.executeCommand('workbench.actions.view.problems');
                    throw new Error(outcome.getError());
                }
            } catch (ex) {
                console.error(ex);
                throw new Error("Plan validation failed: " + ex);
            }
        } else {
            throw new Error("There is no plan file open.");
        }
    }

    async testConfiguration(): Promise<boolean> {
        let validatePath = this.plannerConfiguration.getValidatorPath();
        if (validatePath.length === 0) {
            commands.executeCommand(VAL_DOWNLOAD_COMMAND);
            return false;
        }
        else {
            return true;
        }
    }

    async validatePlanDocument(planDocument: TextDocument): Promise<PlanValidationOutcome> {

        let planFileInfo = <PlanInfo>await this.codePddlWorkspace.upsertAndParseFile(planDocument);

        if (!planFileInfo) { return PlanValidationOutcome.failed(null, new Error("Cannot open or parse plan file.")); }

        return this.validatePlanAndReportDiagnostics(planFileInfo, true, _ => { }, _ => { });
    }

    async validatePlanAndReportDiagnostics(planInfo: PlanInfo, showOutput: boolean, onSuccess: (diagnostics: Map<string, Diagnostic[]>) => void, onError: (error: string) => void): Promise<PlanValidationOutcome> {
        let epsilon = this.plannerConfiguration.getEpsilonTimeStep();
        let validatePath = this.plannerConfiguration.getValidatorPath();

        let context: DomainAndProblem = null;

        try {
            context = getDomainAndProblemForPlan(planInfo, this.codePddlWorkspace.pddlWorkspace);
        } catch (err) {
            let outcome = PlanValidationOutcome.failed(planInfo, err);
            onSuccess(outcome.getDiagnostics());
            return outcome;
        }

        // are the actions in the plan declared in the domain?
        let actionNameDiagnostics = this.validateActionNames(context.domain, context.problem, planInfo);
        if (actionNameDiagnostics.length) {
            let errorOutcome = PlanValidationOutcome.failedWithDiagnostics(planInfo, actionNameDiagnostics);
            onSuccess(errorOutcome.getDiagnostics());
            return errorOutcome;
        }

        // are the actions start times monotonically increasing?
        let actionTimeDiagnostics = this.validateActionTimes(planInfo);
        if (actionTimeDiagnostics.length) {
            let errorOutcome = PlanValidationOutcome.failedWithDiagnostics(planInfo, actionTimeDiagnostics);
            onSuccess(errorOutcome.getDiagnostics());
            return errorOutcome;
        }

        // copy editor content to temp files to avoid using out-of-date content on disk
        let domainFilePath = await Util.toPddlFile('domain', context.domain.getText());
        let problemFilePath = await Util.toPddlFile('problem', context.problem.getText());
        let planFilePath = await Util.toPddlFile('plan', planInfo.getText());

        let args = ['-t', epsilon.toString(), '-v', domainFilePath, problemFilePath, planFilePath];
        let workingDir = this.createWorkingFolder(Uri.parse(planInfo.fileUri));
        let child = process.spawnSync(validatePath, args, { cwd: workingDir });

        if (showOutput) { this.output.appendLine(validatePath + ' ' + args.join(' ')); }

        let outcome: PlanValidationOutcome;

        if (child.error) {
            if (showOutput) {
                this.output.appendLine(`Error: name=${child.error.name}, message=${child.error.message}`);
            }
            onError(child.error.name);
            outcome = PlanValidationOutcome.failed(planInfo, child.error);
            onSuccess(outcome.getDiagnostics());
        }
        else {
            let output = child.stdout.toString();

            if (showOutput) { this.output.appendLine(output); }

            if (showOutput && child.stderr && child.stderr.length) {
                this.output.append('Error:');
                this.output.appendLine(child.stderr.toString());
            }

            outcome = this.analyzeOutput(planInfo, child.error, output);
            onSuccess(outcome.getDiagnostics());
        }

        if (showOutput) {
            this.output.appendLine(`Exit code: ${child.status}`);
            this.output.show();
        }

        return outcome;
    }

    createWorkingFolder(planUri: Uri): string {
        if (planUri.scheme === "file") {
            return dirname(planUri.fsPath);
        }
        let workspaceFolder = workspace.getWorkspaceFolder(planUri);
        if (workspaceFolder) {
            return workspaceFolder.uri.fsPath;
        }

        if (workspace.workspaceFolders && workspace.workspaceFolders.length > 0) {
            return workspace.workspaceFolders[0].uri.fsPath;
        }

        return ".";
    }

    analyzeOutput(planInfo: PlanInfo, error: Error, output: string): PlanValidationOutcome {
        if (error) {
            return PlanValidationOutcome.failed(planInfo, error);
        }

        if (output.match("Plan failed to execute") || output.match("Goal not satisfied")) {
            let failurePattern = /Checking next happening \(time (\d+.\d+)\)/g;
            var result: RegExpExecArray;
            var timeStamp = -1;
            while ((result = failurePattern.exec(output)) !== null) {
                timeStamp = parseFloat(result[1]);
            }

            let match = output.match(/Plan Repair Advice:([\s\S]+)Failed plans:/);
            if (match) {
                return PlanValidationOutcome.failedAtTime(planInfo, timeStamp, match[1].trim().split('\n'));
            } else {
                return PlanValidationOutcome.failedAtTime(planInfo, timeStamp, ["Unidentified error. Run the 'PDDL: Validate plan' command for more info."]);
            }
        }

        if (output.match("Bad plan description!")) {
            return PlanValidationOutcome.invalidPlanDescription(planInfo);
        } else if (output.match("Plan valid")) {
            return PlanValidationOutcome.valid(planInfo);
        }

        return PlanValidationOutcome.unknown(planInfo);
    }

    /**
     * Validate that plan steps match domain actions
     * @param domain domain file
     * @param problem problem file
     * @param plan plan
     */
    validateActionNames(domain: DomainInfo, problem: ProblemInfo, plan: PlanInfo): Diagnostic[] {
        return plan.getSteps()
            .filter(step => !this.isDomainAction(domain, problem, step))
            .map(step => new Diagnostic(createRangeFromLine(step.lineIndex), `Action '${step.getActionName()}' not known by the domain ${domain.name}`, DiagnosticSeverity.Error));
    }

    /**
     * Validate that plan step times are monotonically increasing
     * @param domain domain file
     * @param problem problem file
     * @param plan plan
     */
    validateActionTimes(plan: PlanInfo): Diagnostic[] {
        return plan.getSteps()
            .slice(1)
            .filter((step: PlanStep, index: number) => !this.isTimeMonotonicallyIncreasing(plan.getSteps()[index], step))
            .map(step => new Diagnostic(createRangeFromLine(step.lineIndex), `Action '${step.getActionName()}' time ${step.getStartTime()} is before the preceding action time`, DiagnosticSeverity.Error));
    }

    private isDomainAction(domain: DomainInfo, _problem: ProblemInfo, step: PlanStep): boolean {
        // tslint:disable-next-line: no-unused-expression
        _problem;
        return domain.actions.some(a => a.name.toLowerCase() === step.getActionName().toLowerCase());
    }

    private isTimeMonotonicallyIncreasing(first: PlanStep, second: PlanStep): boolean {
        return first.getStartTime() <= second.getStartTime();
    }
}

class PlanValidationOutcome {
    constructor(public planInfo: PlanInfo, private diagnostics: Diagnostic[], public error: string = null) {

    }

    getError(): string {
        return this.error;
    }

    getDiagnostics(): Map<string, Diagnostic[]> {
        let diagnostics = new Map<string, Diagnostic[]>();
        diagnostics.set(this.planInfo.fileUri, this.diagnostics);
        return diagnostics;
    }

    static goalNotAttained(planInfo: PlanInfo): PlanValidationOutcome {
        let errorLine = planInfo.getSteps().length > 0 ? planInfo.getSteps().slice(-1).pop().lineIndex + 1 : 0;
        let error = "Plan does not reach the goal.";
        let diagnostics = [createDiagnostic(errorLine, 0, error, DiagnosticSeverity.Warning)];
        return new PlanValidationOutcome(planInfo, diagnostics, error);
    }

    /**
     * Creates validation outcomes for invalid plan i.e. plans that do not parse or do not correspond to the domain/problem file.
     */
    static invalidPlanDescription(planInfo: PlanInfo): PlanValidationOutcome {
        let error = "Invalid plan description.";
        let diagnostics = [createDiagnostic(0, 0, error, DiagnosticSeverity.Error)];
        return new PlanValidationOutcome(planInfo, diagnostics, error);
    }

    /**
     * Creates validation outcomes for valid plan, which does not reach the goal.
     */
    static valid(planInfo: PlanInfo): PlanValidationOutcome {
        return new PlanValidationOutcome(planInfo, [], undefined);
    }

    static failed(planInfo: PlanInfo, error: Error): PlanValidationOutcome {
        let message = "Validate tool failed. " + error.message;
        let diagnostic = createDiagnostic(0, 0, message, DiagnosticSeverity.Error);
        if (error instanceof NoProblemAssociated) {
            diagnostic.code = NoProblemAssociated.DIAGNOSTIC_CODE;
        }
        else if (error instanceof NoDomainAssociated) {
            diagnostic.code = NoDomainAssociated.DIAGNOSTIC_CODE;
        }

        return new PlanValidationOutcome(planInfo, [diagnostic], message);
    }

    static failedWithDiagnostics(planInfo: PlanInfo, diagnostics: Diagnostic[]): PlanValidationOutcome {
        return new PlanValidationOutcome(planInfo, diagnostics);
    }

    static failedAtTime(planInfo: PlanInfo, timeStamp: number, repairHints: string[]): PlanValidationOutcome {
        let errorLine = 0;
        let stepAtTimeStamp =
            planInfo.getSteps()
                .find(step => PlanStep.equalsWithin(step.getStartTime(), timeStamp, 1e-4));

        if (stepAtTimeStamp) { errorLine = stepAtTimeStamp.lineIndex; }

        let diagnostics = repairHints.map(hint => new Diagnostic(createRangeFromLine(errorLine), hint, DiagnosticSeverity.Warning));
        return new PlanValidationOutcome(planInfo, diagnostics);
    }

    static unknown(planInfo: PlanInfo): PlanValidationOutcome {
        let diagnostics = [new Diagnostic(createRangeFromLine(0), "Unknown error. Run the 'PDDL: Validate plan' command for more information.", DiagnosticSeverity.Warning)];
        return new PlanValidationOutcome(planInfo, diagnostics, "Unknown error.");
    }
}

export function createRangeFromLine(errorLine: number, errorColumn: number = 0): Range {
    return new Range(errorLine, errorColumn, errorLine, errorColumn + 100);
}

export function createDiagnostic(errorLine: number, errorColumn: number, error: string, severity: DiagnosticSeverity): Diagnostic {
    return new Diagnostic(createRangeFromLine(errorLine, errorColumn), error, severity);
}

export function createDiagnosticFromParsingProblem(problem: ParsingProblem, severity: DiagnosticSeverity): Diagnostic {
    return new Diagnostic(createRangeFromLine(problem.lineIndex, problem.columnIndex), problem.problem, severity);
}