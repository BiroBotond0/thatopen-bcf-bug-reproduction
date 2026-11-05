/* MD
  ## 🐞 Viewpoint: the snapshot has no postproduction
  ---
  `Viewpoint.updateCamera(true)` and `takeSnapshot()` draw the snapshot with `renderer.three.render(scene, camera)`. That skips the renderer's own `update()`, which `PostproductionRenderer` overrides, so the snapshot is the plain scene, not what the user saw.

  This example draws a box with postproduction on (pen style), takes a snapshot, and shows it next to the frame the renderer draws.
*/

import * as THREE from "three";
import Stats from "stats.js";
import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";

/* MD
  ### 🌎 Setting up a world with postproduction
*/

const components = new OBC.Components();

const worlds = components.get(OBC.Worlds);
const world = worlds.create<
  OBC.SimpleScene,
  OBC.OrthoPerspectiveCamera,
  OBF.PostproductionRenderer
>();

world.scene = new OBC.SimpleScene(components);
world.scene.setup();

const container = document.getElementById("thatopen")!;
world.renderer = new OBF.PostproductionRenderer(components, container);
world.camera = new OBC.OrthoPerspectiveCamera(components);
await world.camera.controls.setLookAt(8, 6, 8, 0, 0, 0);

components.init();

world.renderer!.postproduction.enabled = true;
world.renderer!.postproduction.mode = OBF.PostproductionMode.COMPOSER;
world.renderer!.postproduction.style = OBF.PostproductionAspect.PEN;

/* MD
  A box is enough to see the difference:
*/

world.scene.three.add(
  new THREE.Mesh(
    new THREE.BoxGeometry(4, 4, 4),
    new THREE.MeshLambertMaterial({ color: "#8aa" }),
  ),
);

/* MD
  ### 📸 Taking the snapshot
  The viewpoint's snapshot, and the frame the renderer draws, read from the canvas in the same task:
*/

const viewpoints = components.get(OBC.Viewpoints);
viewpoints.world = world;

let snapshotUrl = "";
let frameUrl = "";

const takeSnapshot = async () => {
  const viewpoint = viewpoints.create();
  await viewpoint.updateCamera(true);
  const snapshot = viewpoints.snapshots.get(viewpoint.guid)!;
  snapshotUrl = URL.createObjectURL(
    new Blob([new Uint8Array(snapshot)], { type: "image/png" }),
  );

  world.renderer!.update();
  frameUrl = world.renderer!.three.domElement.toDataURL("image/png");

  report(
    "pixels that differ between the snapshot and the frame",
    await countDifferentPixels(),
    0,
  );
};

/* MD
  ### 🧪 Checking in numbers
  The two images, compared pixel by pixel:
*/

const getPixels = async (url: string) => {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, image.width, image.height).data;
};

const countDifferentPixels = async () => {
  const [frame, snapshot] = await Promise.all([
    getPixels(frameUrl),
    getPixels(snapshotUrl),
  ]);
  let count = 0;
  for (let i = 0; i < frame.length; i += 4) {
    const difference =
      Math.abs(frame[i] - snapshot[i]) +
      Math.abs(frame[i + 1] - snapshot[i + 1]) +
      Math.abs(frame[i + 2] - snapshot[i + 2]);
    if (difference > 30) count++;
  }
  return count;
};

const results: string[] = [];

const report = (label: string, actual: number, expected: number) => {
  const line = `${actual === expected ? "OK" : "BUG"} ${label}: got ${actual}, expected ${expected}`;
  console.log(line);
  results.push(line);
  updatePanel();
};

/* MD
  ### 🧩 Adding some UI
  We will use the `@thatopen/ui` library to add the button, the two images and the result:
*/

BUI.Manager.init();

const [panel, updatePanel] = BUI.Component.create<BUI.PanelSection, {}>(
  (_) => BUI.html`
    <bim-panel active label="5. The snapshot has no postproduction" class="options-menu">
      <bim-panel-section label="Steps">
        <bim-label style="white-space: normal">The box with postproduction on, pen style. Take a snapshot and compare.</bim-label>
        <bim-button label="Take a snapshot" @click=${takeSnapshot}></bim-button>
      </bim-panel-section>
      <bim-panel-section label="renderer.update(): what the user sees">
        <img src=${frameUrl} alt="The frame" style="width: 100%; border: 1px solid #ccd">
      </bim-panel-section>
      <bim-panel-section label="updateCamera(true): the snapshot">
        <img src=${snapshotUrl} alt="The snapshot" style="width: 100%; border: 1px solid #ccd">
      </bim-panel-section>
      <bim-panel-section label="Results">
        ${results.map((line) => BUI.html`<bim-label style="white-space: normal">${line}</bim-label>`)}
      </bim-panel-section>
    </bim-panel>
  `,
  {},
);

document.body.append(panel);

/* MD
  And a button that shows or hides the menu on a phone:
*/

const button = BUI.Component.create<BUI.PanelSection>(() => {
  return BUI.html`
      <bim-button class="phone-menu-toggler" icon="solar:settings-bold"
        @click="${() => {
          if (panel.classList.contains("options-menu-visible")) {
            panel.classList.remove("options-menu-visible");
          } else {
            panel.classList.add("options-menu-visible");
          }
        }}">
      </bim-button>
    `;
});

document.body.append(button);

/* MD
  ### ⏱️ Measuring the performance (optional)
*/

const stats = new Stats();
stats.showPanel(2);
document.body.append(stats.dom);
stats.dom.style.left = "0px";
stats.dom.style.zIndex = "unset";
world.renderer!.onBeforeUpdate.add(() => stats.begin());
world.renderer!.onAfterUpdate.add(() => stats.end());

// Let postproduction draw a few frames first
await new Promise((resolve) => setTimeout(resolve, 1000));
await takeSnapshot();
