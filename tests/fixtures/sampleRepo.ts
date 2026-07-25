import type { SourceFile } from '@/lib/core/types';

/**
 * A small but realistic Next.js + Prisma repository used across the analysis
 * tests. It deliberately contains a circular dependency, a duplicated block, a
 * high-complexity function and a client-exposed secret so the metric and
 * insight paths all have something to find.
 */
export function sampleRepoFiles(): SourceFile[] {
  return [
    file(
      'package.json',
      JSON.stringify(
        {
          name: 'acme-shop',
          description: 'Storefront for Acme',
          license: 'MIT',
          main: 'src/index.ts',
          scripts: { dev: 'next dev', build: 'next build', test: 'vitest run' },
          dependencies: {
            next: '15.0.0',
            react: '19.0.0',
            'react-dom': '19.0.0',
            '@prisma/client': '5.20.0',
            zustand: '5.0.0',
            '@clerk/nextjs': '6.0.0',
            unusedpkg: '1.0.0',
          },
          devDependencies: { typescript: '5.6.0', vitest: '2.0.0', tailwindcss: '4.0.0' },
        },
        null,
        2,
      ),
    ),
    file(
      'tsconfig.json',
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } }, null, 2),
    ),
    file('next.config.ts', 'export default {};\n'),
    file('.github/workflows/ci.yml', 'name: CI\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n'),
    file('Dockerfile', 'FROM node:22\nENV PORT=3000\nARG BUILD_ID\n'),
    file(
      '.env.example',
      'DATABASE_URL=\nCLERK_SECRET_KEY=\nNEXT_PUBLIC_API_SECRET=\nPORT=3000\n',
    ),

    file(
      'prisma/schema.prisma',
      `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  orders    Order[]
  createdAt DateTime @default(now())
}

model Order {
  id      String @id @default(cuid())
  userId  String
  user    User   @relation(fields: [userId], references: [id])
  total   Int
  status  String
}
`,
    ),

    file(
      'src/app/layout.tsx',
      `import './globals.css';
import { ClerkProvider } from '@clerk/nextjs';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
`,
    ),
    file('src/app/globals.css', 'body { margin: 0; }\n'),
    file(
      'src/app/page.tsx',
      `import { ProductList } from '@/components/ProductList';
import { Header } from '@/components/Header';

export default function HomePage() {
  return (
    <main>
      <Header title="Acme" />
      <ProductList />
    </main>
  );
}
`,
    ),
    file(
      'src/app/api/orders/route.ts',
      `import { NextResponse } from 'next/server';
import { createOrder, listOrders } from '@/services/orderService';

export async function GET() {
  return NextResponse.json(await listOrders());
}

export async function POST(request: Request) {
  const body = await request.json();
  if (!body.userId) {
    return NextResponse.json({ error: 'missing user' }, { status: 400 });
  }
  return NextResponse.json(await createOrder(body));
}
`,
    ),
    file(
      'src/app/api/users/[id]/route.ts',
      `import { NextResponse } from 'next/server';
import { getUser } from '@/services/userService';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const user = await getUser(params.id);
  if (!user) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(user);
}
`,
    ),

    file(
      'src/components/Header.tsx',
      `import { Logo } from '@/components/Logo';

export function Header({ title }: { title: string }) {
  return (
    <header>
      <Logo />
      <h1>{title}</h1>
    </header>
  );
}
`,
    ),
    file('src/components/Logo.tsx', 'export function Logo() {\n  return <svg />;\n}\n'),
    file(
      'src/components/ProductList.tsx',
      `import { useProducts } from '@/hooks/useProducts';
import { ProductCard } from '@/components/ProductCard';

export function ProductList() {
  const products = useProducts();
  return (
    <ul>
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </ul>
  );
}
`,
    ),
    file(
      'src/components/ProductCard.tsx',
      `export function ProductCard({ product }: { product: { id: string; name: string } }) {
  return <li>{product.name}</li>;
}
`,
    ),
    file(
      'src/hooks/useProducts.ts',
      `import { useEffect, useState } from 'react';

export function useProducts() {
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    fetch('/api/products').then((response) => response.json()).then(setProducts);
  }, []);
  return products;
}
`,
    ),

    file(
      'src/services/orderService.ts',
      `import { prisma } from '@/lib/db';
import { getUser } from '@/services/userService';
import { formatCurrency } from '@/lib/format';

export interface OrderInput {
  userId: string;
  total: number;
}

export async function listOrders() {
  const orders = await prisma.order.findMany();
  return orders.map((order) => ({ ...order, display: formatCurrency(order.total) }));
}

export async function createOrder(input: OrderInput) {
  const user = await getUser(input.userId);
  if (!user) throw new Error('unknown user');
  return prisma.order.create({ data: { userId: input.userId, total: input.total, status: 'new' } });
}
`,
    ),
    file(
      'src/services/userService.ts',
      `import { prisma } from '@/lib/db';
import { listOrders } from '@/services/orderService';

export async function getUser(id: string) {
  return prisma.user.findUnique({ where: { id } });
}

export async function getUserWithOrders(id: string) {
  const user = await getUser(id);
  const orders = await listOrders();
  return { user, orders };
}
`,
    ),

    file(
      'src/lib/db.ts',
      `import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
});
`,
    ),
    file(
      'src/lib/format.ts',
      `// Shared formatting helpers.
export function formatCurrency(cents: number): string {
  const dollars = cents / 100;
  const rounded = Math.round(dollars * 100) / 100;
  const parts = rounded.toFixed(2).split('.');
  const whole = parts[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
  return '$' + whole + '.' + parts[1];
}

export function formatCompactCurrency(cents: number): string {
  const dollars = cents / 100;
  const rounded = Math.round(dollars * 100) / 100;
  const parts = rounded.toFixed(2).split('.');
  const whole = parts[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
  return '$' + whole + '.' + parts[1];
}
`,
    ),
    file(
      'src/lib/pricing.ts',
      `// TODO: move discount tiers into the database.
// FIXME: rounding drifts on stacked discounts.
export function computePrice(base: number, tier: string, coupon?: string, region?: string): number {
  let price = base;
  if (tier === 'gold') {
    price = price * 0.8;
  } else if (tier === 'silver') {
    price = price * 0.9;
  } else if (tier === 'bronze') {
    price = price * 0.95;
  }
  if (coupon) {
    if (coupon.startsWith('SAVE')) {
      const amount = Number(coupon.slice(4));
      if (!Number.isNaN(amount) && amount > 0 && amount < 50) {
        price = price - amount;
      }
    } else if (coupon === 'FREESHIP') {
      price = price - 5;
    }
  }
  if (region === 'EU') {
    price = price * 1.2;
  } else if (region === 'UK') {
    price = price * 1.2;
  } else if (region === 'US') {
    price = price * 1.07;
  }
  return price > 0 ? price : 0;
}
`,
    ),
    file(
      'src/lib/config.ts',
      `export const config = {
  apiSecret: process.env.NEXT_PUBLIC_API_SECRET,
  clerkKey: process.env.CLERK_SECRET_KEY,
  port: process.env.PORT ?? '3000',
};
`,
    ),
    file(
      'src/index.ts',
      `export { formatCurrency } from '@/lib/format';
export { computePrice } from '@/lib/pricing';
`,
    ),
    file(
      'tests/pricing.test.ts',
      `import { describe, expect, it } from 'vitest';
import { computePrice } from '@/lib/pricing';

describe('computePrice', () => {
  it('applies gold tier', () => {
    expect(computePrice(100, 'gold')).toBeCloseTo(80);
  });
});
`,
    ),
    file('README.md', '# Acme Shop\n\nA storefront.\n'),
  ];
}

function file(path: string, content: string): SourceFile {
  return { path, content, bytes: Buffer.byteLength(content, 'utf8') };
}
