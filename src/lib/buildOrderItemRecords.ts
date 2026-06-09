/** Mirrors sync_imported_orders accessory expansion for manual order create/update. */

export type OrderLineForRecords = {
    product_id?: string | null;
    quantity: number;
    unit_price: number;
    accessories: Array<{
        accessory_id?: string | null;
        accessory_quantity?: number;
        accessory_unit_price?: number;
    }>;
};

export type AccessoryAttachMode = 'fixed' | 'per_item' | 'per_order';

export type ProductAccessoryRow = {
    product_id: string;
    accessory_id: string;
    default_quantity: number;
    /** fixed (default qty per line), per_item (default x product qty), per_order (default once for the order). */
    attach_mode?: AccessoryAttachMode | null;
    created_at?: string | null;
};

/** Accessory quantity for the default-attachment expansion, given the line's product qty. */
export function accessoryQtyForMode(
    mode: AccessoryAttachMode | null | undefined,
    defaultQuantity: number,
    productQuantity: number
): number {
    const base = defaultQuantity ?? 0;
    if (mode === 'per_item') return base * (Number(productQuantity) || 0);
    // per_order: default once for the whole order; fixed: default per line.
    return base;
}

export function buildOrderItemRecords(
    orderId: string,
    item: OrderLineForRecords,
    businessId: string,
    productAccessories: ProductAccessoryRow[],
    accessoryUnitPriceById: Map<string, number>
): Record<string, unknown>[] {
    const pid = item.product_id && item.product_id !== 'none' ? item.product_id : null;

    if (item.accessories && item.accessories.length > 0) {
        return item.accessories.map((acc, i) => ({
            order_id: orderId,
            product_id: pid,
            quantity: i === 0 ? item.quantity : 0,
            unit_price: i === 0 ? item.unit_price : 0,
            accessory_id: acc.accessory_id && acc.accessory_id !== 'none' ? acc.accessory_id : null,
            accessory_quantity: acc.accessory_quantity || 0,
            accessory_unit_price: acc.accessory_unit_price || 0,
            'DigiCom Business': businessId,
        }));
    }

    if (pid) {
        const paRows = productAccessories
            .filter((pa) => pa.product_id === pid)
            .slice()
            .sort((a, b) => {
                const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
                const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
                if (ta !== tb) return ta - tb;
                return a.accessory_id.localeCompare(b.accessory_id);
            });

        if (paRows.length > 0) {
            return paRows.map((pa, i) => ({
                order_id: orderId,
                product_id: pid,
                quantity: i === 0 ? item.quantity : 0,
                unit_price: i === 0 ? item.unit_price : 0,
                accessory_id: pa.accessory_id,
                accessory_quantity: accessoryQtyForMode(pa.attach_mode, pa.default_quantity ?? 0, item.quantity),
                accessory_unit_price: accessoryUnitPriceById.get(pa.accessory_id) ?? 0,
                'DigiCom Business': businessId,
            }));
        }
    }

    return [
        {
            order_id: orderId,
            product_id: pid,
            quantity: item.quantity,
            unit_price: item.unit_price,
            accessory_id: null,
            accessory_quantity: 0,
            accessory_unit_price: 0,
            'DigiCom Business': businessId,
        },
    ];
}
