// --- i18n (Internationalization) ---

const i18n = {
    ja: {
        // Page
        title: 'Fuzz Face 動作点解析',
        page_title: 'Fuzz Face 動作点解析 (SPICE Model)',

        // Result headers
        result_bias: '計算結果 (Bias Resistors)',
        result_current: '計算結果 (Collector Currents)',
        node_voltages: '各点電圧 (Node Voltages)',
        operating_point: '動作点 (Operating Point)',
        ac_analysis: '交流解析 (AC Analysis)',
        output_swing: '出力電圧配分 (Output Voltage Swing)',
        div_ratio: '分圧比 (1/N)',

        // Initial state
        initial_msg: '右側のパラメータを入力し、「計算実行」ボタンを押してください。',

        // Right panel
        circuit_params: '回路パラメータ & SPICEモデル',
        common_settings: '共通設定',
        tab_forward: '順方向計算',
        tab_reverse: '逆計算',

        // Labels
        label_rf: 'R<sub>F</sub> (帰還抵抗):',
        label_ic1: 'I<sub>C1</sub> (目標):',
        label_ic2: 'I<sub>C2</sub> (目標):',
        label_vt: 'V<sub>T</sub> (熱電圧):',
        label_div: '出力分圧 (Number):',
        label_gain: '電圧利得 A<sub>v</sub>',
        label_zin: '入力インピーダンス Z<sub>in</sub>',

        // Buttons
        btn_calc: '計算実行 (Calculate)',
        btn_spice: 'SPICEモデル(文字列)入力に戻す',
        btn_manual: '各パラメータを直接入力する',

        // Errors
        error_prefix: 'エラーが発生しました: ',
        error_jacobian: 'ヤコビアンが特異です。収束できません。',
        error_no_converge: '収束できません。抵抗値を確認してください。',
        error_no_converge_iter: '収束できません (%ITER%回反復)。抵抗値を確認してください。',
        error_vc2_negative: 'V_C2 が負 (%VC2% V) です。R2 (= R2t + R2b = %R2%) が大きすぎます。',
    },
    en: {
        // Page
        title: 'Fuzz Face Operating Point Analysis',
        page_title: 'Fuzz Face Operating Point Analysis (SPICE Model)',

        // Result headers
        result_bias: 'Results (Bias Resistors)',
        result_current: 'Results (Collector Currents)',
        node_voltages: 'Node Voltages',
        operating_point: 'Operating Point',
        ac_analysis: 'AC Analysis',
        output_swing: 'Output Voltage Swing',
        div_ratio: 'Divider Ratio (1/N)',

        // Initial state
        initial_msg: 'Enter parameters on the right and press "Calculate".',

        // Right panel
        circuit_params: 'Circuit Parameters & SPICE Model',
        common_settings: 'Common Settings',
        tab_forward: 'Forward Calc',
        tab_reverse: 'Reverse Calc',

        // Labels
        label_rf: 'R<sub>F</sub> (Feedback):',
        label_ic1: 'I<sub>C1</sub> (Target):',
        label_ic2: 'I<sub>C2</sub> (Target):',
        label_vt: 'V<sub>T</sub> (Thermal V):',
        label_div: 'Output Divider (N):',
        label_gain: 'Voltage Gain A<sub>v</sub>',
        label_zin: 'Input Impedance Z<sub>in</sub>',

        // Buttons
        btn_calc: 'Calculate',
        btn_spice: 'Switch to SPICE model string',
        btn_manual: 'Enter parameters manually',

        // Errors
        error_prefix: 'Error: ',
        error_jacobian: 'Jacobian is singular. Cannot converge.',
        error_no_converge: 'Cannot converge. Check resistor values.',
        error_no_converge_iter: 'Cannot converge (%ITER% iterations). Check resistor values.',
        error_vc2_negative: 'V_C2 is negative (%VC2% V). R2 (= R2t + R2b = %R2%) is too large.',
    }
};

let currentLang = 'ja';

function getLang() {
    return currentLang;
}

function t(key) {
    return (i18n[currentLang] && i18n[currentLang][key]) || (i18n.ja[key]) || key;
}

function setLang(lang) {
    currentLang = lang;
    document.documentElement.setAttribute('lang', lang);
    localStorage.setItem('fuzzface-lang', lang);

    // Update page title
    document.title = t('page_title');

    // Update all elements with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const translation = t(key);
        // Use innerHTML for labels containing HTML (sub tags etc.)
        if (translation.includes('<')) {
            el.innerHTML = translation;
        } else {
            el.textContent = translation;
        }
    });

    // Update language switch display
    const langLabel = document.getElementById('lang-label');
    if (langLabel) {
        langLabel.textContent = lang === 'ja' ? 'JA' : 'EN';
    }

    // Update toggle button text based on current SPICE input modes
    ['q1', 'q2'].forEach(id => {
        const btn = document.querySelector(`button[onclick="toggleMode('${id}')"]`);
        if (btn) {
            btn.textContent = (modes && modes[id] === 'manual') ? t('btn_spice') : t('btn_manual');
        }
    });
}

function toggleLang() {
    const newLang = currentLang === 'ja' ? 'en' : 'ja';
    setLang(newLang);
}

function initLang() {
    const saved = localStorage.getItem('fuzzface-lang');
    if (saved) {
        setLang(saved);
    } else {
        // Detect browser language
        const browserLang = navigator.language || navigator.userLanguage || '';
        const lang = browserLang.startsWith('ja') ? 'ja' : 'en';
        setLang(lang);
    }
}

// Initialize language on page load
initLang();
