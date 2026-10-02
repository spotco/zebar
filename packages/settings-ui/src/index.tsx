/* @refresh reload */
import './index.css';
import { HashRouter, Route } from '@solidjs/router';
import { render } from 'solid-js/web';

import {
  ApiClientProvider,
  AppLayout,
  UserPacksProvider,
  WidgetPreviewProvider,
} from './common';
import { WidgetPage, WidgetPacksPage, WidgetPackPage } from './user-packs';

render(
  () => (
    <ApiClientProvider apiBaseUrl={import.meta.env.VITE_API_URL}>
      <UserPacksProvider>
        <WidgetPreviewProvider>
          <HashRouter root={AppLayout}>
            <Route path="/" component={WidgetPacksPage} />
            <Route path="/packs/:packId" component={WidgetPackPage} />
            <Route
              path="/packs/:packId/:widgetName"
              component={WidgetPage}
            />
          </HashRouter>
        </WidgetPreviewProvider>
      </UserPacksProvider>
    </ApiClientProvider>
  ),
  document.getElementById('root')!,
);
