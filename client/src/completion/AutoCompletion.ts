/* --------------------------------------------------------------------------------------------
 * Copyright (c) Jan Dolejsi. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { CompletionItemProvider, CompletionItem, TextDocument, Position, CancellationToken, CompletionContext, Range } from 'vscode';
import { ProblemInfo } from '../../../common/src/parser';
import { DomainInfo } from '../../../common/src/DomainInfo';
import { KeywordDelegate } from './KeywordDelegate';
import { ProblemInitDelegate } from './ProblemInitDelegate';
import { OperatorDelegate } from './OperatorDelegate';
import { VariableDelegate } from './VariableDelegate';
import { TypeDelegate } from './TypeDelegate';
import { EffectDelegate } from './EffectDelegate';
import { CodePddlWorkspace } from '../workspace/CodePddlWorkspace';

export class AutoCompletion implements CompletionItemProvider {

    // For snippet syntax read this: https://code.visualstudio.com/docs/editor/userdefinedsnippets

    keywordDelegate: KeywordDelegate;
    operatorDelegate: OperatorDelegate;
    variableDelegate: VariableDelegate;
    typeDelegate: TypeDelegate;
    effectDelegate: EffectDelegate;

    constructor(public codePddlWorkspace: CodePddlWorkspace) {
        this.keywordDelegate = new KeywordDelegate();
        this.operatorDelegate = new OperatorDelegate();
        this.variableDelegate = new VariableDelegate(codePddlWorkspace);
        this.typeDelegate = new TypeDelegate(codePddlWorkspace.pddlWorkspace);
        this.effectDelegate = new EffectDelegate(codePddlWorkspace.pddlWorkspace);
    }

    async provideCompletionItems(document: TextDocument, position: Position, token: CancellationToken, context: CompletionContext): Promise<CompletionItem[]> {
        if (token.isCancellationRequested) { return []; }

        let completionCollector = await new CompletionCollector(this.codePddlWorkspace, document, position, context,
            this.keywordDelegate, this.operatorDelegate, this.variableDelegate, this.typeDelegate,
            this.effectDelegate).initialize();
        return completionCollector.getCompletions();
    }
}

class CompletionCollector {
    completions: CompletionItem[] = [];

    lineText: string;
    leadingText: string;

    constructor(private readonly codePddlWorkspace: CodePddlWorkspace, private readonly document: TextDocument,
        private readonly position: Position, private readonly context: CompletionContext,
        private readonly keywordDelegate: KeywordDelegate,
        private readonly operatorDelegate: OperatorDelegate,
        private readonly variableDelegate: VariableDelegate,
        private readonly typeDelegate: TypeDelegate,
        private readonly effectDelegate: EffectDelegate) {

        this.lineText = document.lineAt(position.line).text;
        this.leadingText = this.lineText.substring(0, position.character);
        if (this.leadingText.includes(';')) { return; } // do not auto-complete in comment text
    }

    async initialize(): Promise<CompletionCollector> {

        const activeFileInfo = await this.codePddlWorkspace.upsertFile(this.document);

        if (activeFileInfo.isProblem()) {
            let problemFileInfo = <ProblemInfo>activeFileInfo;

            this.createProblemCompletionItems(problemFileInfo);
        }
        else if (activeFileInfo.isDomain()) {
            let domainFileInfo = <DomainInfo>activeFileInfo;

            this.createDomainCompletionItems(domainFileInfo);
        }

        if (this.leadingText.length > 0 && this.leadingText.endsWith('(')) {
            this.pushAll(this.operatorDelegate.getOperatorItems());
            this.pushAll(this.variableDelegate.getVariableItems(activeFileInfo));
        } else if (this.leadingText.endsWith(' -')) {
            this.pushAll(this.typeDelegate.getTypeItems(activeFileInfo));
        }

        return this;
    }

    getCompletions(): CompletionItem[] {
        return this.completions;
    }

    createDomainCompletionItems(domainFileInfo: DomainInfo): void {
        if (this.isTriggeredByBracketColon()) {
            this.pushAll(this.keywordDelegate.getDomainItems());
        } else if (this.isTriggeredByColon()) {
            this.pushAll(this.keywordDelegate.getActionItems());
        } else if (this.isTriggeredByBracket()) {
            //todo: check if we are inside an action/durative-action
            this.pushAll(this.effectDelegate.getNumericEffectItems(domainFileInfo));
        }
    }

    createProblemCompletionItems(problemFileInfo: ProblemInfo): void {
        if (this.isTriggeredByBracketColon()) {
            this.pushAll(this.keywordDelegate.getProblemItems());
        }

        let folder = this.codePddlWorkspace.pddlWorkspace.getFolderOf(problemFileInfo);
        // find domain files in the same folder that match the problem's domain name
        let domainFiles = folder.getDomainFilesFor(problemFileInfo);

        if (this.isInInit()) {
            new ProblemInitDelegate(this.completions, this.context).createProblemInitCompletionItems(problemFileInfo, domainFiles);
        }
    }

    pushAll(items: CompletionItem[]): void {
        this.completions.push(...items);
    }

    isTriggeredByBracketColon() {
        return this.leadingText.length > 1 && this.leadingText.endsWith('(:');
    }

    isTriggeredByColon() {
        return this.leadingText.length > 0 && this.leadingText.endsWith(':');
    }

    isTriggeredByBracket() {
        return this.leadingText.length > 0 && this.leadingText.endsWith('(');
    }

    isInInit(): boolean {
        let startPosition = new Position(0, 0);
        let endPosition = new Position(this.document.lineCount, 10000);

        return this.document.getText(new Range(startPosition, this.position)).includes('(:init')
            && this.document.getText(new Range(this.position, endPosition)).includes('(:goal');
    }
}
