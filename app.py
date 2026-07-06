"""Gradio UI for stem separation. Run with: python app.py"""

import gradio as gr

from separator import DEFAULT_MODEL, MODELS, separate

# superset of stems across the 4- and 6-stem models, in display order
STEM_ORDER = ["vocals", "drums", "bass", "guitar", "piano", "other"]


def run_separation(audio_path, model_name, progress=gr.Progress(track_tqdm=True)):
    if not audio_path:
        raise gr.Error("Upload a song first.")

    progress(0, desc="Loading model (first run downloads weights)…")
    stems = separate(audio_path, model_name)

    return [
        gr.Audio(value=str(stems[stem]), label=stem, visible=True)
        if stem in stems
        else gr.Audio(value=None, visible=False)
        for stem in STEM_ORDER
    ]


with gr.Blocks(title="Stem Splitter") as demo:
    gr.Markdown(
        """
        # 🎛️ Stem Splitter
        Split a song into stems (vocals, drums, bass, …) with
        [Demucs v4](https://github.com/facebookresearch/demucs). Runs locally.
        """
    )
    with gr.Row():
        with gr.Column():
            audio_in = gr.Audio(label="Song", type="filepath", sources=["upload"])
            model_dd = gr.Dropdown(
                choices=[(f"{name} — {desc}", name) for name, desc in MODELS.items()],
                value=DEFAULT_MODEL,
                label="Model",
            )
            go_btn = gr.Button("Separate", variant="primary")
        with gr.Column():
            stem_players = [
                gr.Audio(label=stem, visible=False) for stem in STEM_ORDER
            ]

    go_btn.click(run_separation, inputs=[audio_in, model_dd], outputs=stem_players)


if __name__ == "__main__":
    demo.launch()
