export type ReportColumn = { key:string; label:string; format:'text'|'number'|'money' };
export type ReportTable = { columns:ReportColumn[]; rows:Record<string,string|number|null>[] };

export function reportCell(value:unknown,format:ReportColumn['format']) {
  if(value===null||value===undefined) return 'Unavailable';
  if(format==='money') return `SGD ${Number(value).toLocaleString('en-SG',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  if(format==='number') return Number(value).toLocaleString('en-SG');
  return String(value);
}

export function reportTableText(table:ReportTable) {
  return [table.columns.map(column=>column.label).join(' | '),...table.rows.map(row=>table.columns.map(column=>reportCell(row[column.key],column.format)).join(' | '))].join('\n');
}

export function validReportTable(value:unknown):value is ReportTable {
  if(!value||typeof value!=='object') return false;
  const table=value as ReportTable;
  return Array.isArray(table.columns)&&table.columns.length>0&&table.columns.length<=12
    &&table.columns.every(column=>column&&typeof column.key==='string'&&typeof column.label==='string'&&['text','number','money'].includes(column.format))
    &&Array.isArray(table.rows)&&table.rows.length<=100
    &&table.rows.every(row=>row&&typeof row==='object'&&table.columns.every(column=>row[column.key]===null||typeof row[column.key]==='string'||(typeof row[column.key]==='number'&&Number.isFinite(row[column.key]))));
}
