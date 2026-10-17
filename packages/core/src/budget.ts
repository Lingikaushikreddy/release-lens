import { AnalysisError, type Report } from './types';
export function applyBudget(report:Report,maxGrowth:number):Report {
  if(!Number.isSafeInteger(maxGrowth)||maxGrowth<0) throw new AnalysisError('FORMAT','Growth budget must be a nonnegative safe integer in bytes.');
  return {...report,budget:report.unpackedDelta<=maxGrowth?'pass':'fail'};
}
