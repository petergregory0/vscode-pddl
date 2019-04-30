/* --------------------------------------------------------------------------------------------
 * Copyright (c) Jan Dolejsi. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { State } from "./State";
import { StateResolver } from "./StateResolver";
import { SearchHappening } from "./SearchHappening";
import { HappeningType } from "../../../common/src/HappeningsInfo";
import { HelpfulAction } from "../../../common/src/Plan";

export class MessageParser {

    private lastStateOrder = -1;
    private stateIdToOrder = new Map<string, number>();

    constructor(private readonly search: StateResolver) {

    }

    parseInitialState(state: any): State {
        if (this.stateIdToOrder.size > 0 || this.lastStateOrder > -1) throw new Error("Search debugger must be cleared before re-starting the search.");
        let assignedStateId = ++this.lastStateOrder;
        this.stateIdToOrder.set(state.id, assignedStateId);

        return new State(assignedStateId, state.id, state.g, state.earliestTime, []);
    }

    parseState(state: any): State {
        let assignedStateId = this.stateIdToOrder.get(state.id);
        if (assignedStateId === undefined) {
            assignedStateId = ++this.lastStateOrder;
            this.stateIdToOrder.set(state.id, assignedStateId);
        }
        let parentId = this.stateIdToOrder.get(state.parentId);

        let planHead = <SearchHappening[]>state.planHead;

        let actionName = this.createActionName(planHead);

        return new State(assignedStateId, state.id, state.g, state.earliestTime, planHead,
            parentId, actionName);
    }

    createActionName(planHead: SearchHappening[]): string {
        var actionName = 'Undefined?';

        if (planHead.length > 0) {
            let lastHappening = planHead[planHead.length - 1];

            actionName = lastHappening.actionName;
            if (lastHappening.shotCounter > 0) actionName += `[${lastHappening.shotCounter}]`;
            switch (lastHappening.kind) {
                case HappeningType.START:
                    actionName += '├';
                    break;
                case HappeningType.END:
                    actionName += ' ┤';
                    break;
            }

            return actionName;
        } else {
            console.log("No planhead!!");
        }

        return actionName;
    }

    parseEvaluatedState(state: any): State {
        var assignedStateId = this.stateIdToOrder.get(state.id);
        if (assignedStateId === undefined) {
            throw new Error(`State with id ${state.id} is unknown`);
        }
        let stateFound = this.search.getState(assignedStateId);
        if (!stateFound) throw new Error(`State with id ${state.id} not found.`);

        let relaxedPlan = <SearchHappening[]>state.relaxedPlan;
        let helpfulActions = <HelpfulAction[]>state.helpfulActions;

        return stateFound.evaluate(state.h, state.totalMakespan, helpfulActions, relaxedPlan);
    }
}