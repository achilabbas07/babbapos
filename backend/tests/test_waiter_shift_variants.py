from targets import _qty_map


def test_sold_item_quantity_is_grouped_by_product_and_variant_id():
    grouped = _qty_map([
        {
            "productId": "PRD-001",
            "productName": "Kopi",
            "variantId": 10,
            "variantName": "Panas",
            "qty": 2,
        },
        {
            "productId": "PRD-001",
            "productName": "Kopi",
            "variantId": 10,
            "variantName": "Panas",
            "qty": 3,
        },
        {
            "productId": "PRD-001",
            "productName": "Kopi",
            "variantId": 11,
            "variantName": "Dingin",
            "qty": 1,
        },
        {
            "productId": "PRD-002",
            "productName": "Teh",
            "variantId": None,
            "variantName": "",
            "qty": 4,
        },
    ])

    assert len(grouped) == 3
    assert grouped[("PRD-001", ("id", "10"))] == [5, "Kopi", "Panas", 10]
    assert grouped[("PRD-001", ("id", "11"))] == [1, "Kopi", "Dingin", 11]
    assert grouped[("PRD-002", ("name", ""))] == [4, "Teh", "", None]
