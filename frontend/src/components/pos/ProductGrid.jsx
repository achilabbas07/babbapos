import { useMemo, useState } from "react";
import { Search, UtensilsCrossed } from "lucide-react";
import { rp } from "@/lib/api";

const ProductCard = ({ product, stock, ojol, onAdd, index }) => {
  const price = ojol && product.price_ojol > 0 ? product.price_ojol : product.price;

  return (
    <button
      type="button"
      data-testid={`pos-product-${product.id}`}
      onClick={() => onAdd(product)}
      style={{ animationDelay: `${index * 30}ms` }}
      className="fade-up group touch-manipulation overflow-hidden rounded-xl border border-border bg-card text-left shadow-sm transition-transform duration-200 hover:-translate-y-0.5 hover:border-primary/60 active:scale-[0.97]"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-secondary">
        {stock[product.id] != null && stock[product.id] < 1 && (
          <span data-testid={`pos-product-stock-minus-${product.id}`} className="absolute left-1.5 top-1.5 z-10 rounded-full bg-destructive px-2 py-0.5 text-[10px] font-bold text-white shadow">
            {stock[product.id] < 0 ? "Stok Minus" : "Stok 0"}
          </span>
        )}
        {product.image ? (
          <img src={product.image} alt={product.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
        ) : (
          <div className="grid h-full place-items-center text-muted-foreground"><UtensilsCrossed className="h-8 w-8" /></div>
        )}
      </div>
      <div className="p-2.5">
        <p className="line-clamp-2 min-h-[2.25rem] text-[13px] font-semibold leading-snug">{product.name}</p>
        <p data-testid={`pos-product-price-${product.id}`} className="mt-1 font-mono text-xs font-semibold text-primary">
          {rp(price)}{ojol && <span className="ml-1 font-sans text-[10px] text-muted-foreground">Ojol</span>}
        </p>
      </div>
    </button>
  );
};

export const ProductGrid = ({ products, stock = {}, onAdd, ojol }) => {
  const [cat, setCat] = useState("Semua");
  const [q, setQ] = useState("");
  const cats = useMemo(() => ["Semua", ...new Set(products.map((p) => p.category))], [products]);
  const list = useMemo(
    () => products.filter((p) => (cat === "Semua" || p.category === cat) && p.name.toLowerCase().includes(q.toLowerCase())),
    [products, cat, q],
  );
  return (
    <div>
      <div className="mb-4 flex flex-col gap-2.5 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            data-testid="pos-search-input"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Cari menu..."
            className="h-10 w-full rounded-xl border border-border bg-card pl-10 pr-4 text-sm outline-none transition-colors focus:border-primary"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto">
          {cats.map((category) => (
            <button
              key={category}
              type="button"
              data-testid={`pos-category-${category.toLowerCase().replace(/\s+/g, "-")}`}
              onClick={() => setCat(category)}
              className={`h-10 shrink-0 touch-manipulation rounded-xl px-3.5 text-sm font-medium transition-colors ${cat === category ? "bg-primary text-primary-foreground" : "border border-border bg-card text-muted-foreground hover:text-foreground"}`}
            >
              {category}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(128px,1fr))]">
        {list.map((product, index) => (
          <ProductCard
            key={product.id}
            product={product}
            stock={stock}
            ojol={ojol}
            onAdd={onAdd}
            index={index}
          />
        ))}
      </div>
      {list.length === 0 && <p className="py-16 text-center text-sm text-muted-foreground">Menu tidak ditemukan.</p>}
    </div>
  );
};
