import { createRouter, createWebHistory } from "vue-router";

import { CI_STUDIO } from "./app/ci/flags";
import WorkspaceView from "./views/WorkspaceView.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: WorkspaceView },
    { path: "/storage", redirect: "/" },
    // CI: the hosted Studio has no demo document and no collab rooms (ADR-058 §8).
    ...(CI_STUDIO
      ? [{ path: "/:pathMatch(.*)*", redirect: "/" }]
      : [
          { path: "/demo", component: WorkspaceView, meta: { demo: true } },
          { path: "/share/:roomId", component: WorkspaceView },
        ]),
  ],
});

export default router;
