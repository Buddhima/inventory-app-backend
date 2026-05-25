class Component {
  constructor({
    componentDescription,
    componentEAN,
    componentCode,
    unitCost,
    stockQty,
    componentQuantity,
  }) {
    if (!componentCode) {
      throw new Error("componentCode is required");
    }

    this.componentDescription = componentDescription ?? null;
    this.componentEAN = componentEAN;
    this.componentCode = componentCode;
    this.unitCost = Number(unitCost);
    this.stockQty = Number(stockQty || 0);
    this.componentQuantity = Number(componentQuantity);
  }

  // Derived property based on stockQty
  get isAdditionalCost() {
    // Example: true if stockQty is 0
    return this.stockQty === 0;
  }

  static fromRequest(payload) {
    return new Component(payload);
  }
}

module.exports = Component;
