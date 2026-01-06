/* =========================================================
   IMVpedia Voice — tracks.js
   Trilhas (Básico → Avançado) + caminhos por estilo
========================================================= */

window.TRACKS = [
  {
    id: "track_fundamentos",
    type: "track",
    title: "Fundamentos Vocais",
    subtitle: "Básico • Respiração, apoio, postura, SOVT, afinação",
    cover: "🎤",
    level: "Básico",
    tags: ["saúde", "técnica", "base"],
    lessonIds: [
      "les_postura_01",
      "les_respiracao_01",
      "les_apoio_01",
      "les_sovt_01",
      "les_onset_01",
      "les_afina_01",
      "les_articulacao_01",
      "les_desaq_01"
    ]
  },

  {
    id: "track_controle_extensao",
    type: "track",
    title: "Controle e Extensão",
    subtitle: "Intermediário • Registro, passaggio, mix, projeção e resistência",
    cover: "🧭",
    level: "Intermediário",
    tags: ["coordenação", "registro", "resistência"],
    lessonIds: [
      "les_registros_01",
      "les_passaggio_01",
      "les_mix_01",
      "les_ressonancia_01",
      "les_tw_01",
      "les_dinamica_01",
      "les_agilidade_01",
      "les_endurance_01"
    ]
  },

  {
    id: "track_performance_estilo",
    type: "track",
    title: "Performance e Estilo",
    subtitle: "Avançado • Interpretação, estilo, repertório e palco",
    cover: "🎭",
    level: "Avançado",
    tags: ["arte", "interpretação", "palco"],
    lessonIds: [
      "les_interpretacao_01",
      "les_repertorio_01",
      "les_microfone_01",
      "les_palco_01",
      "les_estilos_01",
      "les_rotina_01"
    ]
  },

  {
    id: "track_popular",
    type: "track",
    title: "Canto Popular",
    subtitle: "Popular • Mix, belting seguro, estilo e resistência",
    cover: "🔥",
    level: "Todos",
    tags: ["popular", "mix", "performance"],
    lessonIds: [
      "les_pop_mix_01",
      "les_belt_safe_01",
      "les_vibrato_pop_01",
      "les_runs_01",
      "les_distortion_safe_01"
    ]
  },

  {
    id: "track_erudito",
    type: "track",
    title: "Canto Erudito",
    subtitle: "Erudito • Legato, ressonância, vogais, projeção e fôlego",
    cover: "🎼",
    level: "Todos",
    tags: ["erudito", "legato", "vogais"],
    lessonIds: [
      "les_legato_01",
      "les_vogais_01",
      "les_formantes_01",
      "les_messa_01",
      "les_diccao_01"
    ]
  },

  {
    id: "track_coral",
    type: "track",
    title: "Coral e Grupos Vocais",
    subtitle: "Coral • Blend, afinação, ritmo, entradas e equilíbrio",
    cover: "👥",
    level: "Todos",
    tags: ["coral", "blend", "afinação"],
    lessonIds: [
      "les_blend_01",
      "les_coral_afin_01",
      "les_ritmo_01",
      "les_entradas_01",
      "les_harmonia_01"
    ]
  }
];
