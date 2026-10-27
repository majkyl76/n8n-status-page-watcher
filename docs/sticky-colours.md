# Sticky note colour numbers

The Sticky Note node (`n8n-nodes-base.stickyNote`) stores its colour as an integer
in `parameters.color`. The node default is `1` (yellow):

`/workspace/n8n-local/node_modules/n8n-nodes-base/dist/nodes/StickyNote/StickyNote.node.js`
lines 40 to 45 define the `color` parameter as `type: 'number'`, `default: 1`.

The integer is mapped to a colour "variant" in the editor UI stylesheet
`/workspace/n8n-local/node_modules/n8n-editor-ui/dist/assets/app-CU_fYePl.css`.
The sticky background variables resolve like this:

| color value | CSS variant      | background source        | colour  |
| ----------- | ---------------- | ------------------------ | ------- |
| 1 (default) | variant-1        | `--color--yellow-100`    | yellow  |
| 2           | variant-2        | `--color--gold-100`      | gold    |
| 3           | variant-3        | `--color--red-100`       | red     |
| 4           | variant-4        | `--color--green-100`     | green   |
| 5           | variant-5        | `--color--blue-100`      | blue    |
| 6           | variant-6        | `--color--purple-200`    | purple  |
| 7           | variant-7        | `--color--neutral-100`   | white   |

So for this template:

- **1 = yellow** for the one main overview sticky.
- **7 = white** for the section stickies.
- **3 = red** for the single warning sticky on the Send Email node.

Evidence (CSS, same file):

```
--sticky--color--background:var(--color--yellow-100);
--sticky--color--background--variant-3:var(--color--red-100);
--sticky--color--background--variant-7:var(--color--neutral-100);
```
