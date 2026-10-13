use eframe::egui;

use crate::model::{ChapterId, Story};

/// Root application state.
///
/// Currently a story with one selected chapter. As features land, this stays a
/// thin shell that delegates to `model/` (data) and, later, `persistence/`.
pub struct GmingToolApp {
    story: Story,
    selected: ChapterId,
}

impl GmingToolApp {
    pub fn new() -> Self {
        let story = Story::new();
        let selected = story.chapters()[0].id;
        Self { story, selected }
    }

    /// Draw the whole UI into `ui`.
    ///
    /// Split out from [`eframe::App::ui`] so it can also be driven headlessly
    /// in tests, without an `eframe::Frame` or a real window.
    pub fn draw(&mut self, ui: &mut egui::Ui) {
        // Split the borrows so the closures below can mutate `story` while
        // reading and writing `selected`.
        let Self { story, selected } = self;

        egui::Panel::left("chapter_list")
            .default_size(220.0)
            .resizable(true)
            .show(ui, |ui| {
                ui.heading("Chapters");
                ui.add_space(4.0);

                if ui.button("➕ New chapter").clicked() {
                    *selected = story.add_chapter();
                }

                ui.separator();

                egui::ScrollArea::vertical()
                    .auto_shrink([false, false])
                    .show(ui, |ui| {
                        for chapter in story.chapters() {
                            let is_selected = *selected == chapter.id;
                            if ui.selectable_label(is_selected, &chapter.title).clicked() {
                                *selected = chapter.id;
                            }
                        }
                    });
            });

        egui::CentralPanel::default().show(ui, |ui| {
            if let Some(chapter) = story.chapter_mut(*selected) {
                ui.heading(&chapter.title);
                ui.separator();

                egui::ScrollArea::vertical()
                    .auto_shrink([false, false])
                    .show(ui, |ui| {
                        ui.add(
                            egui::TextEdit::multiline(&mut chapter.text)
                                // Per-chapter editor state: cursor and scroll
                                // position are remembered separately.
                                .id_salt(chapter.id)
                                .desired_width(f32::INFINITY)
                                .desired_rows(30)
                                .hint_text("Write the story for this chapter…"),
                        );
                    });
            }
        });
    }
}

impl Default for GmingToolApp {
    fn default() -> Self {
        Self::new()
    }
}

impl eframe::App for GmingToolApp {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.draw(ui);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use egui::accesskit::Role;
    use egui_kittest::{Harness, kittest::Queryable};

    impl GmingToolApp {
        /// Number of chapters in the current story.
        fn chapter_count(&self) -> usize {
            self.story.chapters().len()
        }

        /// Title of the currently selected chapter.
        fn selected_title(&self) -> &str {
            self.story
                .chapters()
                .iter()
                .find(|c| c.id == self.selected)
                .expect("a chapter is always selected")
                .title
                .as_str()
        }
    }

    fn harness(app: GmingToolApp) -> Harness<'static, GmingToolApp> {
        Harness::new_ui_state(|ui, app: &mut GmingToolApp| app.draw(ui), app)
    }

    fn editor(harness: &Harness<'_, GmingToolApp>) -> String {
        harness
            .get_by_role(Role::MultilineTextInput)
            .value()
            .unwrap_or_default()
    }

    #[test]
    fn starts_with_a_single_selected_chapter() {
        let harness = harness(GmingToolApp::new());
        assert_eq!(harness.state().chapter_count(), 1);
        assert_eq!(harness.state().selected_title(), "Chapter 1");
    }

    #[test]
    fn new_chapter_button_appends_and_selects_it() {
        let mut harness = harness(GmingToolApp::new());

        harness.get_by_label("➕ New chapter").click();
        harness.run();

        assert_eq!(harness.state().chapter_count(), 2);
        assert_eq!(harness.state().selected_title(), "Chapter 2");
    }

    #[test]
    fn switching_chapters_shows_that_chapters_own_text() {
        let mut harness = harness(GmingToolApp::new());

        // Write into chapter 1.
        harness.get_by_role(Role::MultilineTextInput).focus();
        harness
            .get_by_role(Role::MultilineTextInput)
            .type_text("alpha");
        harness.run();
        assert_eq!(editor(&harness), "alpha");

        // Add and switch to chapter 2: the editor must be empty.
        harness.get_by_label("➕ New chapter").click();
        harness.run();
        assert_eq!(editor(&harness), "");

        // Write different text into chapter 2.
        harness.get_by_role(Role::MultilineTextInput).focus();
        harness
            .get_by_role(Role::MultilineTextInput)
            .type_text("beta");
        harness.run();
        assert_eq!(editor(&harness), "beta");

        // Switch back to chapter 1: chapter 1's text must reappear.
        harness
            .get_by_role_and_label(Role::Button, "Chapter 1")
            .click();
        harness.run();
        assert_eq!(harness.state().selected_title(), "Chapter 1");
        assert_eq!(editor(&harness), "alpha");
    }
}
