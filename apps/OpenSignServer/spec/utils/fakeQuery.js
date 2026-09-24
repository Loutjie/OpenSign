// An in-memory stand-in for Parse.Query over plain rows, for unit specs that run without a
// Parse server. It really filters: a query that drops a condition returns the wrong rows.
class FakeRow {
  constructor(table, fields) {
    this.table = table;
    this.fields = fields;
    this.ops = {};
  }
  get id() {
    return this.fields.objectId;
  }
  get(key) {
    return this.fields[key];
  }
  set(key, value) {
    this.fields[key] = value;
  }
  unset(key) {
    delete this.fields[key];
  }
  increment(key, amount = 1) {
    this.ops[key] = (this.ops[key] || 0) + amount;
  }
  async save(_attrs, options) {
    this.table.saves.push({ fields: { ...this.fields }, ops: { ...this.ops }, options });
    for (const [key, amount] of Object.entries(this.ops)) {
      this.fields[key] = (Number(this.fields[key]) || 0) + amount;
    }
    this.ops = {};
    if (!this.table.rows.includes(this.fields)) {
      this.fields.objectId ??= `row${this.table.rows.length + 1}`;
      this.table.rows.push(this.fields);
    }
    return this;
  }
  toJSON() {
    return { ...this.fields };
  }
}

export class FakeTable {
  constructor(rows = []) {
    this.rows = rows;
    this.saves = [];
    this.queries = [];
  }
  create() {
    return new FakeRow(this, {});
  }
  query() {
    const conditions = [];
    const record = { conditions, includes: [], options: null };
    this.queries.push(record);
    const matches = () => this.rows.filter(row => conditions.every(test => test(row)));
    const q = {
      equalTo(key, value) {
        conditions.push(row => row[key] === value);
        return q;
      },
      notEqualTo(key, value) {
        conditions.push(row => row[key] !== value);
        return q;
      },
      containedIn(key, values) {
        conditions.push(row => values.includes(row[key]));
        return q;
      },
      exists(key) {
        conditions.push(row => row[key] !== undefined && row[key] !== null);
        return q;
      },
      include(key) {
        record.includes.push(key);
        return q;
      },
      first: async options => {
        record.options = options;
        const row = matches()[0];
        return row ? new FakeRow(this, row) : undefined;
      },
      find: async options => {
        record.options = options;
        return matches().map(row => new FakeRow(this, row));
      },
    };
    return q;
  }
}
