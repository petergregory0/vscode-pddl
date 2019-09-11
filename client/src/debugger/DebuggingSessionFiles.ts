/* --------------------------------------------------------------------------------------------
 * Copyright (c) Jan Dolejsi. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { ProblemInfo } from '../../../common/src/parser';
import { DomainInfo } from '../../../common/src/DomainInfo';
import { HappeningsInfo } from "../../../common/src/HappeningsInfo";

/**
 * Files involved in the debugging session.
 */
export interface DebuggingSessionFiles {
	domain: DomainInfo;
	problem: ProblemInfo;
	happenings: HappeningsInfo;
}