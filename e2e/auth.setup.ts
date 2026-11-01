import { test as setup } from '@playwright/test';
import { signIn, storageStatePath, type TenantKey } from './support';

for (const tenant of ['acme', 'globex'] as const satisfies TenantKey[]) {
  setup(`sign in as the ${tenant} member`, async ({ page }) => {
    await signIn(page, tenant);
    await page.context().storageState({ path: storageStatePath(tenant) });
  });
}
