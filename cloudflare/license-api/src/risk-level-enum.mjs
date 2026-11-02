export const RiskLevel = Object.freeze({
  UNKNOWN: 'unknown',
  LOW: 'low',
  MEDIUM_LOW: 'medium_low',
  MEDIUM: 'medium',
  MEDIUM_HIGH: 'medium_high',
  HIGH: 'high',
  CRITICAL: 'critical',
});

const aliases = new Map(Object.entries({
  unknown:'unknown',not_assessed:'unknown',unassessed:'unknown',pending:'unknown',
  '待评估':'unknown','待核验':'unknown','未观测':'unknown','未知':'unknown','-':'unknown','--':'unknown',
  low:'low',minor:'low','低':'low','较低':'low','低风险':'low',
  medium_low:'medium_low','中低':'medium_low','中低风险':'medium_low',
  medium:'medium',moderate:'medium','中':'medium','中等':'medium','中风险':'medium','中等风险':'medium',
  medium_high:'medium_high','中高':'medium_high','中高风险':'medium_high',
  high:'high','较高':'high','高':'high','高风险':'high',
  critical:'critical',severe:'critical',extreme:'critical',danger:'critical',
  '极高':'critical','极高风险':'critical','严重':'critical','危险':'critical','熔断':'critical',
}));

const labelTables = Object.freeze({
  short:Object.freeze({unknown:'待核验',low:'低',medium_low:'中低',medium:'中',medium_high:'中高',high:'高',critical:'极高'}),
  standard:Object.freeze({unknown:'待评估',low:'较低',medium_low:'中低',medium:'中等',medium_high:'中高',high:'较高',critical:'严重'}),
  risk:Object.freeze({unknown:'风险待评估',low:'低风险',medium_low:'中低风险',medium:'中等风险',medium_high:'中高风险',high:'高风险',critical:'极高风险'}),
  evidence:Object.freeze({unknown:'未观测',low:'较低',medium_low:'中低',medium:'中等',medium_high:'中高',high:'较高',critical:'严重'}),
  runtime:Object.freeze({unknown:'待核验',low:'低',medium_low:'中低',medium:'中',medium_high:'中高',high:'高',critical:'熔断'}),
});

const severity = Object.freeze({low:0,medium_low:1,medium:2,medium_high:3,high:4,critical:5});
const scoreTables = Object.freeze({
  cognition:Object.freeze({unknown:50,low:20,medium_low:35,medium:45,medium_high:60,high:80,critical:90}),
  portfolio:Object.freeze({unknown:0,low:30,medium_low:45,medium:60,medium_high:72,high:85,critical:95}),
});

const token = value => String(value ?? '').trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');

export const isKnownRiskLevel = value => aliases.has(token(value));
export const normalizeRiskLevel = (value, fallback=RiskLevel.UNKNOWN) =>
  aliases.get(token(value)) || aliases.get(token(fallback)) || RiskLevel.UNKNOWN;

export function riskLevelLabel(value, {style='short', unknownLabel=null, fallback=null}={}) {
  const table=labelTables[style];
  if(!table) throw new Error(`unknown risk label style: ${style}`);
  if(!isKnownRiskLevel(value) && fallback !== null) return fallback;
  const level=normalizeRiskLevel(value);
  if(level===RiskLevel.UNKNOWN && unknownLabel !== null) return unknownLabel;
  return table[level];
}

export const riskLevelSeverity = value => severity[normalizeRiskLevel(value)] ?? null;
export const riskLevelIsAtLeast = (value, threshold) => {
  const current=riskLevelSeverity(value),floor=riskLevelSeverity(threshold);
  return current !== null && floor !== null && current >= floor;
};
export const riskLevelColorRole = value => {
  const level=normalizeRiskLevel(value);
  if(level===RiskLevel.HIGH || level===RiskLevel.CRITICAL) return 'danger';
  if(level===RiskLevel.MEDIUM || level===RiskLevel.MEDIUM_HIGH) return 'warning';
  if(level===RiskLevel.LOW || level===RiskLevel.MEDIUM_LOW) return 'success';
  return 'muted';
};
export const riskLevelScore = (value, {profile='cognition'}={}) => {
  const table=scoreTables[profile];
  if(!table) throw new Error(`unknown risk score profile: ${profile}`);
  return table[normalizeRiskLevel(value)];
};
export const mobileRiskLevelFromScore = value => {
  const number=Number(value);
  if(!Number.isFinite(number)) return RiskLevel.UNKNOWN;
  if(number>=80) return RiskLevel.CRITICAL;
  if(number>=60) return RiskLevel.HIGH;
  if(number>=35) return RiskLevel.MEDIUM;
  return RiskLevel.LOW;
};
