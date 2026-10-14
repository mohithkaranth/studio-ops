export function fixtureSql(db, onResult = () => {}) {
  class Fragment {
    constructor(strings, values) {this.strings = strings; this.values = values;}
    compile(params) {
      let query = this.strings[0];
      this.values.forEach((value,i) => {
        if (value instanceof Fragment) query += value.compile(params);
        else {params.push(value); query += `$${params.length}`;}
        query += this.strings[i+1];
      });
      return query;
    }
    then(resolve,reject) {
      const params=[];
      return db.query(this.compile(params),params).then(result=>{onResult(result.rows);return result.rows;}).then(resolve,reject);
    }
  }
  const sql=(strings,...values)=>new Fragment(strings,values);
  sql.unsafe=(query,values=[])=> {
    if (!values.length) return new Fragment([query],[]);
    const strings=[]; const bound=[]; let position=0;
    for (const match of query.matchAll(/\$(\d+)/g)) {
      strings.push(query.slice(position,match.index));bound.push(values[Number(match[1])-1]);position=match.index+match[0].length;
    }
    strings.push(query.slice(position));return new Fragment(strings,bound);
  };
  sql.array=value=>value;
  sql.json=value=>JSON.stringify(value);
  sql.begin=async callback=> {await db.exec('BEGIN');try{const result=await callback(sql);await db.exec('COMMIT');return result;}catch(error){await db.exec('ROLLBACK');throw error;}};
  return sql;
}
