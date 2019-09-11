/* --------------------------------------------------------------------------------------------
 * Copyright (c) Jan Dolejsi. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as assert from 'assert';
import { PddlSyntaxTreeBuilder } from '../src/PddlSyntaxTreeBuilder';
import { PddlTokenType } from '../src/PddlTokenizer';
import { PddlSyntaxNode } from '../src/PddlSyntaxNode';
import { parseParameters } from '../src/VariablesParser';

describe('PddlSyntaxTree', () => {

    describe('#getDefineNode()', () => {

        it('gets define node', () => {
            // GIVEN
            let domainPddl = `(define (domain domain_name))`;
            let tree = new PddlSyntaxTreeBuilder(domainPddl).getTree();

            // WHEN
            let defineNode = tree.getDefineNode();

            // THEN
            assert.notStrictEqual(defineNode, undefined, 'there should be a (define element');
        });
    });
});

describe('PddlSyntaxNode', () => {

    describe('#getFirstOpenBracketOrThrow', () => {
        it('gets domain node', () => {
            // GIVEN
            let domainPddl = `(define (domain domain_name))`;
            let tree = new PddlSyntaxTreeBuilder(domainPddl).getTree();

            // WHEN
            let domainNode = tree.getDefineNode().getFirstOpenBracketOrThrow('domain');

            // THEN
            assert.notStrictEqual(domainNode, undefined, 'there should be a (domain element');
        });
    });

    describe('#getFirstOpenBracketOrThrow', () => {
        it('throws', () => {
            // GIVEN
            let domainPddl = `(define (problem name))`;
            let tree = new PddlSyntaxTreeBuilder(domainPddl).getTree();

            // THEN
            assert.throws(() => {
                // WHEN
                tree.getDefineNode().getFirstOpenBracketOrThrow('domain');
            });
        });

        it('gets problem', () => {
            // GIVEN
            let domainPddl = `(define (problem name))`;
            let tree = new PddlSyntaxTreeBuilder(domainPddl).getTree();

            // THEN
            assert.ok(tree.getDefineNode().getFirstOpenBracketOrThrow('problem'));
        });
    });

    describe('#getKeywordOpenBracket', () => {
        it('returns undefined for missing keyword', () => {
            // GIVEN
            let actionPddl = `(action)`;
            let action = new PddlSyntaxTreeBuilder(actionPddl).getTree().getRootNode().getSingleChild();

            // WHEN
            let keywordBracket = action.getKeywordOpenBracket('keyword');

            // THEN
            assert.strictEqual(keywordBracket, undefined);
        });

        it('returns undefined for missing brackets nested in the keyword', () => {
            // GIVEN
            let actionPddl = `(action :keyword)`;
            let action = new PddlSyntaxTreeBuilder(actionPddl).getTree().getRootNode().getSingleChild();

            // WHEN
            let keywordBracket = action.getKeywordOpenBracket('keyword');

            // THEN
            assert.strictEqual(keywordBracket, undefined);
        });

        it('returns empty brackets', () => {
            // GIVEN
            let actionPddl = `(action :keyword())`;
            let action = new PddlSyntaxTreeBuilder(actionPddl).getTree().getRootNode().getSingleChild();

            // WHEN
            let keywordBracket = action.getKeywordOpenBracket('keyword');

            // THEN
            assert.ok(keywordBracket);
            assert.strictEqual(keywordBracket.getNestedChildren().length, 0);
        });

        it('returns bracket contents', () => {
            // GIVEN
            let actionPddl = `(action :keyword(p))`;
            let action = new PddlSyntaxTreeBuilder(actionPddl).getTree().getRootNode().getSingleChild();

            // WHEN
            let keywordBracket = action.getKeywordOpenBracket('keyword');

            // THEN
            assert.ok(keywordBracket);
            assert.strictEqual(keywordBracket.getNestedChildren().length, 1);
            assert.strictEqual(keywordBracket.getText(), '(p)');
        });

        it('returns bracket contents after whitespace', () => {
            // GIVEN
            let actionPddl = `(action :keyword         (p))`;
            let action = new PddlSyntaxTreeBuilder(actionPddl).getTree().getRootNode().getSingleChild();

            // WHEN
            let keywordBracket = action.getKeywordOpenBracket('keyword');

            // THEN
            assert.ok(keywordBracket);
            assert.strictEqual(keywordBracket.getNestedChildren().length, 1);
            assert.strictEqual(keywordBracket.getText(), '(p)');
        });

        it('returns non-trivial bracket contents - conjunction', () => {
            // GIVEN
            let actionPddl = `(action :keyword (and (p)(q)))`;
            let action = new PddlSyntaxTreeBuilder(actionPddl).getTree().getRootNode().getSingleChild();

            // WHEN
            let keywordBracket = action.getKeywordOpenBracket('keyword');

            // THEN
            assert.ok(keywordBracket);
            assert.strictEqual(keywordBracket.getNonWhitespaceChildren().length, 2);
            assert.strictEqual(keywordBracket.getToken().tokenText, '(and');
        });

        it("returns capital keyword's bracket contents", () => {
            // GIVEN
            let actionPddl = `(action :KEYWORD(p))`;
            let action = new PddlSyntaxTreeBuilder(actionPddl).getTree().getRootNode().getSingleChild();

            // WHEN
            let keywordBracket = action.getKeywordOpenBracket('keyword');

            // THEN
            assert.ok(keywordBracket);
            assert.strictEqual(keywordBracket.getNestedChildren().length, 1);
            assert.strictEqual(keywordBracket.getText(), '(p)');
        });
    });

    describe('#getChildren()', () => {

        it('gets define node', () => {
            // GIVEN
            let domainPddl = `(define (domain domain_name))`;
            let tree = new PddlSyntaxTreeBuilder(domainPddl).getTree();
            let defineNode = tree.getDefineNode();

            // WHEN
            let children = defineNode.getChildren();

            // THEN
            let tokenTypes = children.map(f => f.getToken().type);
            assert.deepStrictEqual(tokenTypes, [
                PddlTokenType.Whitespace,
                PddlTokenType.OpenBracketOperator, // (domain ...)
                PddlTokenType.CloseBracket,
            ]);
        });
    });

    describe('#getNestedChildren()', () => {

        it('gets define node', () => {
            // GIVEN
            let domainPddl = `(define (domain domain_name))`;
            let tree = new PddlSyntaxTreeBuilder(domainPddl).getTree();
            let defineNode = tree.getDefineNode();

            // WHEN
            let children = defineNode.getNestedChildren();

            // THEN
            let tokenTypes = children.map(f => f.getToken().type);
            assert.deepStrictEqual(tokenTypes, [
                PddlTokenType.Whitespace,
                PddlTokenType.OpenBracketOperator, // (domain ...)
            ]);
        });
    });

    describe('#getChildrenRecursively()', () => {

        it('it finds no child', () => {
            // GIVEN
            let domainPddl = `(define)`;

            let tree = new PddlSyntaxTreeBuilder(domainPddl).getTree();
            let defineNode = tree.getDefineNode();

            // WHEN
            let children: PddlSyntaxNode[] = [];
            defineNode.getChildrenRecursively((_node: PddlSyntaxNode) => true, (node: PddlSyntaxNode) => children.push(node));

            // THEN
            assert.strictEqual(children.length, 0, 'there should be zero matches');
        });

        it('it finds one whitespace', () => {
            // GIVEN
            let domainPddl = `(define )`;

            let tree = new PddlSyntaxTreeBuilder(domainPddl).getTree();
            let defineNode = tree.getDefineNode();

            // WHEN
            let children: PddlSyntaxNode[] = [];
            defineNode.getChildrenRecursively((_node: PddlSyntaxNode) => true, (node: PddlSyntaxNode) => children.push(node));

            // THEN
            assert.strictEqual(children.length, 1, 'there should be one match');
            assert.strictEqual(children[0].getToken().type, PddlTokenType.Whitespace);
        });

        it('it finds no reference to predicate in comment', () => {
            // GIVEN
            let domainPddl = "(define ; (p)\n)";

            let tree = new PddlSyntaxTreeBuilder(domainPddl).getTree();
            let defineNode = tree.getDefineNode();

            // WHEN
            let children: PddlSyntaxNode[] = [];
            defineNode.getChildrenRecursively(node => node.getToken().type === PddlTokenType.OpenBracket
                && node.getSingleChild().getToken().tokenText === 'p',
                (node: PddlSyntaxNode) => children.push(node));

            // THEN
            assert.strictEqual(children.length, 0, 'there should be zero matches');
        });

        
        it('it finds two reference to predicate', () => {
            // GIVEN
            let domainPddl = "(define (p)\n (sub (p)))";

            let tree = new PddlSyntaxTreeBuilder(domainPddl).getTree();
            let defineNode = tree.getDefineNode();

            // WHEN
            let children: PddlSyntaxNode[] = [];
            defineNode.getChildrenRecursively(node => node.getToken().type === PddlTokenType.OpenBracket
                && node.getSingleChild().getToken().tokenText === 'p',
                (node: PddlSyntaxNode) => children.push(node));

            // THEN
            assert.strictEqual(children.length, 2, 'there should be two matches');
        });

    });

    /*
    describe('#getChildRecursively()', () => {
        it('returns undefined if no child matched', () => {
            // GIVEN
            let input = `(parent (child grandchild))`;
            let tree = new PddlSyntaxTreeBuilder(input).getTree();
            let rootNode = tree.getRootNode().getSingleChild();

            // WHEN
            let child = rootNode.getChildRecursively(PddlTokenType.Comment, /./);

            // THEN
            assert.strictEqual(child, undefined);
        });

        it('does not find itself', () => {
            // GIVEN
            let input = `(parent (child grandchild))`;
            let tree = new PddlSyntaxTreeBuilder(input).getTree();
            let rootNode = tree.getRootNode().getSingleChild();

            // WHEN
            let child = rootNode.getChildRecursively(PddlTokenType.OpenBracket, /\(parent/);

            // THEN
            assert.strictEqual(child, undefined);
        });
        
        it('finds first child', () => {
            // GIVEN
            let input = `(parent (and grandchild))`;
            let tree = new PddlSyntaxTreeBuilder(input).getTree();
            let rootNode = tree.getRootNode().getSingleChild();

            // WHEN
            let child = rootNode.getChildRecursively(PddlTokenType.OpenBracketOperator, /\(and/);

            // THEN
            assert.ok(child);
            assert.strictEqual(child.getToken().tokenText, '(and');
        });
        
        it('finds grand child', () => {
            // GIVEN
            let input = `(parent (and grandchild))`;
            let tree = new PddlSyntaxTreeBuilder(input).getTree();
            let rootNode = tree.getRootNode().getSingleChild();

            // WHEN
            let child = rootNode.getChildRecursively(PddlTokenType.Other, /grandchild/);

            // THEN
            assert.ok(child);
            assert.strictEqual(child.getToken().tokenText, 'grandchild');
        });
    });
    */

    describe('#getNonWhitespaceChildren()', () => {

        it('gets all requirements', () => {
            // GIVEN
            let domainPddl = `(:requirements :req1 :req2)`;
            let tree = new PddlSyntaxTreeBuilder(domainPddl).getTree();
            let requirementsNode = tree.getRootNode().getFirstOpenBracketOrThrow(':requirements');

            // WHEN
            let children = requirementsNode.getNonWhitespaceChildren();

            // THEN
            let tokenText = children.map(f => f.getToken().tokenText);
            assert.deepStrictEqual(tokenText, [
                ':req1',
                ':req2'
            ]);
        });
    });

    describe('#getText()', () => {

        it('gets single node text', () => {
            // GIVEN
            let originalPddl = `name`;
            let tree = new PddlSyntaxTreeBuilder(originalPddl).getTree();

            // WHEN
            let actual = tree.getRootNode().getText();

            // THEN
            assert.strictEqual(actual, originalPddl);
        });

        it('gets type declaration node text', () => {
            // GIVEN
            let originalPddl = `child1 chlid2 - parent`;
            let tree = new PddlSyntaxTreeBuilder(originalPddl).getTree();

            // WHEN
            let actual = tree.getRootNode().getText();

            // THEN
            assert.strictEqual(actual, originalPddl);
        });
    });

    describe('#getNestedText()', () => {

        it('gets single nested node text i.e. empty', () => {
            // GIVEN
            let originalPddl = `name`;
            let tree = new PddlSyntaxTreeBuilder(originalPddl).getTree();

            // WHEN
            let actual = tree.getRootNode() // note that the root node is the DOCUMENT node
                .getNestedText();

            // THEN
            assert.strictEqual(actual, originalPddl);
        });

        it('gets (:types) node text', () => {
            // GIVEN
            let originalPddl = `child1 chlid2 - parent`;
            let tree = new PddlSyntaxTreeBuilder(originalPddl).getTree();

            // WHEN
            let actual = tree.getRootNode().getNestedText();

            // THEN
            assert.strictEqual(actual, originalPddl);
        });
    });

    describe('#findAncestor()', () => {
        it('returns null for non-existent ancestor', () => {
            // GIVEN
            let originalPddl = `(:process :parameters(?p - some-type))`;
            let paramNode = new PddlSyntaxTreeBuilder(originalPddl).getTree().getNodeAt(originalPddl.indexOf('?p'));

            // WHEN
            let actual = paramNode.findAncestor(PddlTokenType.OpenBracketOperator, /^\(\s*:action$/);

            // THEN
            assert.strictEqual(actual, null);
        });

        it('finds ancestor', () => {
            // GIVEN
            let originalPddl = `(:action :parameters(?p - some-type))`;
            let paramNode = new PddlSyntaxTreeBuilder(originalPddl).getTree().getNodeAt(originalPddl.indexOf('?p'));

            // WHEN
            let actual = paramNode.findAncestor(PddlTokenType.OpenBracketOperator, /^\(\s*:action$/);

            // THEN
            assert.ok(actual);
            assert.strictEqual(actual.getToken().tokenText, '(:action');
        });
    });

    describe('#findParametrisableScope()', () => {
        it('returns null for non-existent scope', () => {
            // GIVEN
            let originalPddl = `(:something :parameters(?p - some-type))`;
            let paramNode = new PddlSyntaxTreeBuilder(originalPddl).getTree().getNodeAt(originalPddl.indexOf('?p')+1);

            // WHEN
            let actual = paramNode.findParametrisableScope('p');

            // THEN
            assert.ok(actual);
            assert.strictEqual(actual.getToken().type, PddlTokenType.OpenBracket);
        });

        it('finds action ancestor', () => {
            // GIVEN
            let originalPddl = `(:action :parameters(?p - some-type))`;
            let paramNode = new PddlSyntaxTreeBuilder(originalPddl).getTree().getNodeAt(originalPddl.indexOf('?p')+1);

            // WHEN
            let actual = paramNode.findParametrisableScope('p');

            // THEN
            assert.ok(actual);
            assert.strictEqual(actual.getToken().tokenText, '(:action');
        });
        
        it('finds durative action ancestor', () => {
            // GIVEN
            let originalPddl = `(:durative-action :parameters(?p - some-type))`;
            let paramNode = new PddlSyntaxTreeBuilder(originalPddl).getTree().getNodeAt(originalPddl.indexOf('?p')+1);

            // WHEN
            let actual = paramNode.findParametrisableScope('p');

            // THEN
            assert.ok(actual);
            assert.strictEqual(actual.getToken().tokenText, '(:durative-action');
        });
        
        it('finds `forall` ancestor', () => {
            // GIVEN
            let originalPddl = `(forall (?p - some-type))`;
            let paramNode = new PddlSyntaxTreeBuilder(originalPddl).getTree().getNodeAt(originalPddl.indexOf('?p')+1);

            // WHEN
            let actual = paramNode.findParametrisableScope('p');

            // THEN
            assert.ok(actual);
            assert.strictEqual(actual.getToken().tokenText, '(forall');
        });

        it('finds `:derived` ancestor', () => {
            // GIVEN
            let originalPddl = `(:derived (notP ?p1 - type1)
            (not (p ?p1))
        )`;
            let paramNode = new PddlSyntaxTreeBuilder(originalPddl).getTree().getNodeAt(originalPddl.lastIndexOf('?p1')+1);

            // WHEN
            let actual = paramNode.findParametrisableScope('p1');

            // THEN
            assert.ok(actual);
            assert.strictEqual(actual.getToken().tokenText, '(:derived');
        });

        it('finds `:action`, although it is nesting `forall` ancestor', () => {
            // GIVEN
            let originalPddl = `(:action :parameters (?p1 - some-type) (forall (?p2 - some-type) (p ?p1 ?p2))`;
            let paramNode = new PddlSyntaxTreeBuilder(originalPddl).getTree().getNodeAt(originalPddl.lastIndexOf('?p1')+1);

            // WHEN
            let actual = paramNode.findParametrisableScope('p1');

            // THEN
            assert.ok(actual);
            assert.strictEqual(actual.getToken().tokenText, '(:action');
        });
    });

    describe('#getParameterDefinition()', () => {
        it('finds parameter definition in (:action', () => {
            // GIVEN
            let originalPddl = `(:action :parameters (?p1 - some-type) (forall (?p2 - some-type) (p ?p1 ?p2))`;
            let paramNode = new PddlSyntaxTreeBuilder(originalPddl).getTree().getNodeAt(originalPddl.lastIndexOf('?p1')+1);

            const parameterName = "p1";
            // WHEN
            let scope = paramNode.findParametrisableScope(parameterName);
            let parameterDefinitionNode = scope && scope.getParameterDefinition();
            let parameter = parseParameters(parameterDefinitionNode.getText()).find(p => p.name===parameterName);
    
            // THEN
            assert.ok(parameter);
            assert.strictEqual(parameter.name, parameterName);
            assert.strictEqual(parameter.type, 'some-type');
        });
    });
    
    describe('#expand()', () => {
        it('predicate name expands to include brackets', () => {
            // GIVEN
            let originalPddl = `(and (p ?p1 ?p2))`;
            let paramNode = new PddlSyntaxTreeBuilder(originalPddl).getTree().getNodeAt(originalPddl.indexOf('?p1')+1);

            // WHEN
            let actual = paramNode.expand();

            // THEN
            assert.ok(actual);
            assert.strictEqual(actual.getText(), '(p ?p1 ?p2)');
        });
    });
});

describe('PddlBracketNode', () => {

    describe('#getText()', () => {

        it('gets single node text', () => {
            // GIVEN
            let originalPddl = `(define )`;
            let tree = new PddlSyntaxTreeBuilder(originalPddl).getTree();

            // WHEN
            let actual = tree.getDefineNode().getText();

            // THEN
            assert.strictEqual(actual, originalPddl);
        });

        it('gets (:types ) node text', () => {
            // GIVEN
            let originalPddl = `(:types child1 chlid2 - parent)`;
            let tree = new PddlSyntaxTreeBuilder(originalPddl).getTree();

            // WHEN
            let actual = tree.getRootNode().getSingleChild().getText();

            // THEN
            assert.strictEqual(actual, originalPddl);
        });
    });

    describe('#getNestedText()', () => {

        it('gets single node text', () => {
            // GIVEN
            let originalPddl = `(define )`;
            let tree = new PddlSyntaxTreeBuilder(originalPddl).getTree();

            // WHEN
            let actual = tree.getDefineNode().getNestedText();

            // THEN
            assert.strictEqual(actual, ' ');
        });

        it('gets (:types ) node text', () => {
            // GIVEN
            let originalPddl = `(:types child1 chlid2 - parent)`;
            let tree = new PddlSyntaxTreeBuilder(originalPddl).getTree();

            // WHEN
            let actual = tree.getRootNode().getSingleChild().getNestedText();

            // THEN
            assert.strictEqual(actual, ' child1 chlid2 - parent');
        });
    });
});