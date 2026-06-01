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

  static fromRequest(payload) {
    return new Component(payload);
  }
}

module.exports = Component;
