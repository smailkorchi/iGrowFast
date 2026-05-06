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

export type ProductAccessoryRow = {
    product_id: string;
    accessory_id: string;
    default_quantity: number;
    created_at?: string | null;
};

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
                accessory_quantity: pa.default_quantity ?? 0,
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
