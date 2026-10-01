"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CountryOption, InsurerOption } from "@/lib/queries";
import { InsurerMark } from "./ui";

type Product = { id: string; name: string; available: boolean };

export default function ArenaPicker({ countries, modes }: { countries: CountryOption[]; modes: { id: string; label: string }[] }) {
  const router = useRouter();
  const [country, setCountry] = useState(countries[0]?.code ?? "");
  const [products, setProducts] = useState<Product[]>([]);
  const [product, setProduct] = useState("");
  const [insurers, setInsurers] = useState<InsurerOption[]>([]);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [ai, setAi] = useState(modes[0]?.id ?? "rules");
  const [loadedFor, setLoadedFor] = useState("");
  const loading = loadedFor !== `${country}/${product}/${ai}`;

  useEffect(() => {
    if (!country) return;
    let live = true;
    fetch(`/api/countries/${country}/products`)
      .then((r) => r.json())
      .then((list: Product[]) => {
        if (!live) return;
        setProducts(list);
        setProduct((p) => (list.find((x) => x.id === p && x.available) ? p : list.find((x) => x.available)?.id ?? ""));
      });
    return () => {
      live = false;
    };
  }, [country]);

  useEffect(() => {
    if (!country || !product) return;
    let live = true;
    fetch(`/api/countries/${country}/products/${product}/insurers?ai=${ai}`)
      .then((r) => r.json())
      .then((list: InsurerOption[]) => {
        if (!live) return;
        setInsurers(list);
        setA((x) => (list.some((i) => i.slug === x) ? x : ""));
        setB((x) => (list.some((i) => i.slug === x) ? x : ""));
        setLoadedFor(`${country}/${product}/${ai}`);
      });
    return () => {
      live = false;
    };
  }, [country, product, ai]);

  const ready = country && product && a && b && a !== b;
  const byslug = useMemo(() => new Map(insurers.map((i) => [i.slug, i])), [insurers]);
  // In a group market (e.g. Fairfax) every option shares the group, so the tag adds nothing.
  const showGroup = new Set(insurers.map((i) => i.group)).size > 1;

  function random() {
    if (insurers.length < 2) return;
    const i = Math.floor(Math.random() * insurers.length);
    let j = Math.floor(Math.random() * (insurers.length - 1));
    if (j >= i) j++;
    setA(insurers[i].slug);
    setB(insurers[j].slug);
  }

  function go(e: React.FormEvent) {
    e.preventDefault();
    if (ready) router.push(`/c/${country.toLowerCase()}/${product}/${a}-vs-${b}?ai=${ai}`);
  }

  return (
    <form onSubmit={go} className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-7">
      <ol className="grid gap-6">
        <li>
          <label htmlFor="country" className="mb-2 block text-sm font-medium">
            <span className="mr-2 text-muted">1</span>Country
          </label>
          <select
            id="country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 sm:w-80"
          >
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.name}
              </option>
            ))}
          </select>
        </li>

        <li>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">
              <span className="mr-2 text-muted">2</span>Product
            </legend>
            <div className="flex flex-wrap gap-2">
              {products.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={!p.available}
                  aria-pressed={product === p.id}
                  onClick={() => setProduct(p.id)}
                  title={p.available ? undefined : "Fewer than two insurers offer this product here"}
                  className={`rounded-full border px-4 py-1.5 text-sm transition ${
                    product === p.id ? "border-accent bg-accent-soft font-medium text-accent" : "border-line hover:bg-surface-2"
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </fieldset>
        </li>

        <li>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-medium">
              <span className="mr-2 text-muted">3</span>Two insurers
            </span>
            <button type="button" onClick={random} disabled={insurers.length < 2} className="text-sm text-accent hover:underline disabled:opacity-40">
              Random matchup
            </button>
          </div>
          <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <InsurerSelect id="insurer-a" label="First insurer" value={a} other={b} onChange={setA} insurers={insurers} loading={loading} showGroup={showGroup} />
            <span className="text-center text-sm font-semibold text-muted">vs</span>
            <InsurerSelect id="insurer-b" label="Second insurer" value={b} other={a} onChange={setB} insurers={insurers} loading={loading} showGroup={showGroup} />
          </div>
          {(byslug.get(a) || byslug.get(b)) && (
            <p className="mt-2 text-xs text-muted">
              {[byslug.get(a), byslug.get(b)]
                .filter((i): i is InsurerOption => !!i)
                .map((i) => `${i.name}: ${i.fresh ? `audited ${new Date(i.auditedAt!).toLocaleDateString("en-GB")}` : i.blocker ?? "needs a fresh audit (about 1 to 5 min)"}`)
                .join(" · ")}
            </p>
          )}
        </li>
        {modes.length > 1 && (
          <li>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">
                <span className="mr-2 text-muted">4</span>AI that drives and judges
              </legend>
              <div className="flex flex-wrap gap-2">
                {modes.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={ai === m.id}
                    onClick={() => setAi(m.id)}
                    className={`rounded-full border px-4 py-1.5 text-sm transition ${
                      ai === m.id ? "border-accent bg-accent-soft font-medium text-accent" : "border-line hover:bg-surface-2"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </fieldset>
          </li>
        )}
      </ol>

      <button
        type="submit"
        disabled={!ready}
        className="mt-7 w-full rounded-lg bg-accent px-5 py-3 font-semibold text-surface transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
      >
        Compare
      </button>
    </form>
  );
}

function InsurerSelect(props: {
  id: string;
  label: string;
  value: string;
  other: string;
  onChange: (v: string) => void;
  insurers: InsurerOption[];
  loading: boolean;
  showGroup: boolean;
}) {
  const current = props.insurers.find((i) => i.slug === props.value);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5">
      {current ? <InsurerMark name={current.name} color={current.color} size={26} /> : <span className="h-[26px] w-[26px] rounded-full border border-dashed border-line" />}
      <label htmlFor={props.id} className="sr-only">
        {props.label}
      </label>
      <select id={props.id} value={props.value} onChange={(e) => props.onChange(e.target.value)} className="w-full bg-transparent py-1.5 outline-none">
        <option value="">{props.loading ? "Loading…" : `Choose ${props.label.toLowerCase()}`}</option>
        {props.insurers.map((i) => (
          <option key={i.slug} value={i.slug} disabled={i.slug === props.other}>
            {i.name}
            {props.showGroup && i.group ? ` (${i.group})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
