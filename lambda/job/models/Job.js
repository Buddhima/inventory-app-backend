const Component = require("./Component");

class Job {
  constructor({
    bomHeader,
    supplier,
    bomHeaderDescription,
    bomEAN,
    signature,
    components
  }) {
    if (!bomHeader) throw new Error("bomHeader is required");
    if (!Array.isArray(components)) {
      throw new Error("components must be an array");
    }

    this.bomHeader = bomHeader;
    this.supplier = Number(supplier);
    this.bomHeaderDescription = bomHeaderDescription ?? null;
    this.bomEAN = bomEAN;
    this.signature = signature ?? null;

    // 🔑 convert nested payloads to models
    this.components = components.map(c => Component.fromRequest(c));
  }

  static fromRequest(payload) {
    return new Job(payload);
  }
}

module.exports = Job;