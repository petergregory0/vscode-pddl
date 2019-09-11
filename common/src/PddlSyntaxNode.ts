/* --------------------------------------------------------------------------------------------
* Copyright (c) Jan Dolejsi. All rights reserved.
* Licensed under the MIT License. See License.txt in the project root for license information.
* ------------------------------------------------------------------------------------------ */
'use strict';

import { PddlToken, PddlTokenType, TextRange, isOpenBracket } from "./PddlTokenizer";

/** Single node in the syntax tree that wraps one PDDL tokenizer token. */
export class PddlSyntaxNode extends TextRange {
    private children = new Array<PddlSyntaxNode>();

    private maxChildEnd: number;

    /**
     * Creates the syntax tree node.
     * @param token pddl token wrapped by this node
     * @param parent parent node, unless this is the root node
     */
    constructor(private token: PddlToken, private parent?: PddlSyntaxNode) {
        super();
        this.maxChildEnd = token.getEnd();
    }

    static createRoot(): PddlSyntaxNode {
        return new PddlSyntaxNode(new PddlToken(PddlTokenType.Document, '', 0), undefined);
    }

    isRoot(): boolean {
        return this.parent === undefined;
    }

    getParent(): PddlSyntaxNode | undefined {
        return this.parent;
    }

    getToken(): PddlToken {
        return this.token;
    }

    addChild(childNode: PddlSyntaxNode): void {
        this.children.push(childNode);
        this.recalculateEnd(childNode);
    }

    recalculateEnd(childNode: TextRange) {
        this.maxChildEnd = Math.max(this.maxChildEnd, childNode.getEnd());
        if (this.parent) { this.parent.recalculateEnd(this); }
    }

    getChildren(): PddlSyntaxNode[] {
        return this.children;
    }

    getNestedChildren(): PddlSyntaxNode[] {
        return this.getChildren();
    }

    getSingleChild(): PddlSyntaxNode {
        if (this.getNestedChildren().length !== 1) {
            throw new Error(`Failed assertion that node '${this.getText()}' has a single child.`);
        }
        return this.getNestedChildren()[0];
    }

    getNonWhitespaceChildren(): PddlSyntaxNode[] {
        return this.getNestedChildren().filter(c => c.getToken().type !== PddlTokenType.Whitespace);
    }

    getSingleNonWhitespaceChild(): PddlSyntaxNode {
        let nonWhitespaceChildren = this.getNonWhitespaceChildren();
        if (nonWhitespaceChildren.length !== 1) {
            throw new Error(`Failed assertion that node '${this.toString()}' has a single non-whitespace child.`);
        }
        return nonWhitespaceChildren[0];
    }

    getChildrenOfType(type: PddlTokenType, pattern: RegExp): PddlSyntaxNode[] {
        return this.children.filter(c => c.getToken().type === type)
            .filter(node => node.getToken().tokenText.match(pattern));
    }

    getFirstChild(type: PddlTokenType, pattern: RegExp): PddlSyntaxNode {
        return this.children.filter(c => c.getToken().type === type)
            .find(node => node.getToken().tokenText.match(pattern));
    }

    getFirstChildOrThrow(type: PddlTokenType, pattern: RegExp): PddlSyntaxNode {
        let matchingChild = this.getFirstChild(type, pattern);

        if (!matchingChild) {
            throw new Error(`No child element of type ${type} satisfying pattern ${pattern.source}.`);
        }

        return matchingChild;
    }

    getFirstOpenBracket(keyword: string): PddlBracketNode {
        return <PddlBracketNode>this.getFirstChild(PddlTokenType.OpenBracketOperator, new RegExp('\\(\\s*' + keyword + '$', 'i'));
    }

    getFirstOpenBracketOrThrow(keyword: string): PddlBracketNode {
        let matchingNode = this.getFirstOpenBracket(keyword);

        if (!matchingNode) {
            throw new Error(`No child '${keyword}' open bracket.`);
        }

        return matchingNode;
    }

    getChildrenRecursively(test: (node: PddlSyntaxNode) => boolean, callback: (node: PddlSyntaxNode) => void) {
        this.getNestedChildren().forEach(child => {
            try {
                if (test(child)) { callback(child); }
            }
            catch(_e) {
                // swallow
            }
            finally {
                child.getChildrenRecursively(test, callback);
            }
        });
    }

    /**
     * Finds the bracket nested inside the `:keyword`.
     * @param keyword keyword name e.g. 'precondition' to match ':precondition (*)' 
     */
    getKeywordOpenBracket(keyword: string): PddlBracketNode {
        let keywordNode = this.getFirstChild(PddlTokenType.Keyword, new RegExp(":" + keyword + "$", "i"));

        if (!keywordNode) {
            return undefined;
        }

        let bracket = keywordNode.getNonWhitespaceChildren().find(child => isOpenBracket(child.getToken()));

        if (bracket) {
            return <PddlBracketNode>bracket;
        }
        else {
            return undefined;
        }
    }

    hasChildren(): boolean {
        return this.getNestedChildren().length > 0;
    }

    getNestedText(): string {
        let nestedText = '';
        this.getNestedChildren()
            .forEach(node => { nestedText = nestedText + node.getText(); });
        return nestedText;
    }

    getNestedNonCommentText(): string {
        let nestedText = '';
        this.getNestedChildren()
            .filter(node => node.isNotType(PddlTokenType.Comment))
            .forEach(node => { nestedText = nestedText + node.getText(); });
        return nestedText;
    }

    getText(): string {
        return this.getToken().tokenText + this.getNestedText();
    }

    getStart(): number {
        return this.token.getStart();
    }

    getEnd(): number {
        return this.maxChildEnd;
    }

    findAncestor(type: PddlTokenType, pattern: RegExp): PddlSyntaxNode {
        let parent = this.parent;

        while(parent.isNotType(PddlTokenType.Document)) {
            if (parent.isType(type) && pattern.test(parent.getToken().tokenText)) {
                return parent;
            }
            parent = parent.parent;
        }

        return null;
    }
    
    findParametrisableScope(parameterName: string): PddlSyntaxNode {
        let node: PddlSyntaxNode = this;
        while (!node.isDocument()) {
            node = node.findAncestor(PddlTokenType.OpenBracketOperator, /^\(\s*(:action|:durative-action|:process|:event|:derived|forall|exists)$/);
            if (!node) { return this.getParent(); }
            if (node.declaresParameter(parameterName)) {
                return node;
            }
        }

        return undefined;
    }

    getParameterDefinition(): PddlSyntaxNode {
        if (this.getToken().tokenText.match(/:action|:durative-action|:process|:event/)) {
            // this node is expected to have a :parameters keyword
            return this.getKeywordOpenBracket('parameters');
        }
        else {
            // this node is expected to have parameters defined inside parentheses
            let nonWhitespaceChildren = this.getNonWhitespaceChildren();
            if (nonWhitespaceChildren.length === 0) { return undefined; }
            let firstChild = nonWhitespaceChildren[0];
            if (!isOpenBracket(firstChild.getToken())) { return undefined; }
            return firstChild;
        }
    }

    /**
     * Checks whether this scope node defines given parameter.
     * @param parameterName parameter name without the `?` sign
     */
    declaresParameter(parameterName: string): boolean {
        let parametersNode = this.getParameterDefinition();
        let parameterDefinition = parametersNode && parametersNode.getNestedText();
        
        let pattern = new RegExp("\\?"+parameterName+"\\b");
        return parameterDefinition && pattern.test(parameterDefinition);
    }

    expand(): PddlSyntaxNode {
        var node: PddlSyntaxNode = this;
        while (!isOpenBracket(node.getToken()) && !node.isDocument()) {
            node = node.getParent();
        }

        if (node.isDocument()) {
            return undefined;
        }
        else {
            return node;
        }
    }

    isDocument(): boolean {
        return this.isType(PddlTokenType.Document);
    }

    isType(type: PddlTokenType): boolean {
        return this.getToken().type === type;
    }

    isNotType(type: PddlTokenType): boolean {
        return this.getToken().type !== type;
    }

    toString(): string {
        return `${this.token.type}: text: '${this.token.tokenText.split(/\r?\n/).join('\\n')}', range: ${this.getStart()}~${this.getEnd()}}`;
    }
}

/** Specialized tree node for open/close bracket pair. */
export class PddlBracketNode extends PddlSyntaxNode {
    private closeToken: PddlToken;
    private _isClosed: boolean;

    /**
     * Sets the bracket close token.
     * @param token pddl bracket close token
     */
    setCloseBracket(token: PddlToken): void {
        this._isClosed = true;
        this.closeToken = token;
        this.addChild(new PddlSyntaxNode(token));
        this.recalculateEnd(token);
    }

    getCloseBracket(): PddlToken {
        return this.closeToken;
    }

    public get isClosed(): boolean {
        return this._isClosed;
    }

    getNestedChildren(): PddlSyntaxNode[] {
        return this.getChildren()
            .filter(child => child.getToken() !== this.closeToken);
    }

    getText(): string {
        return this.getToken().tokenText + this.getNestedText() + this.closeToken.tokenText;
    }
}
