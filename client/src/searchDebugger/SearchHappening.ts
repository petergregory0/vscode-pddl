/* --------------------------------------------------------------------------------------------
 * Copyright (c) Jan Dolejsi. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { HappeningType } from "../../../common/src/HappeningsInfo";
import { HelpfulAction } from "../../../common/src/Plan";

export interface SearchHappening {
    earliestTime: number;
    actionName: string;
    shotCounter: number;
    kind: HappeningType;
    isRelaxed: boolean;
}

export class MockSearchHappening implements SearchHappening{
    constructor(public readonly earliestTime: number, public readonly actionName: string,
        public readonly shotCounter: number, public readonly kind: HappeningType, 
        public readonly isRelaxed: boolean) { }

    toString(): string {
        let relaxed = this.isRelaxed ? '*' : '';
        return `${this.earliestTime}: ${this.actionName}[${this.shotCounter}] ${this.kind}${relaxed}`;
    }
}

export class MockHelpfulAction implements HelpfulAction {
    constructor(public readonly actionName: string, public readonly kind: HappeningType) { }

    static start(actionName: string): MockHelpfulAction {
        return new MockHelpfulAction(actionName, HappeningType.START);
    }

    static end(actionName: string): MockHelpfulAction {
        return new MockHelpfulAction(actionName, HappeningType.END);
    }
}