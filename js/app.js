/**
 * IELTS Academic Reading Platform - Application Core
 * High-reliability test engine, persistence, scoring, resizable split-pane & tutor features.
 */

(function () {
    'use strict';

    // Application State
    const AppState = {
        testData: null,
        currentPassage: 1,
        userAnswers: {},
        flaggedQuestions: new Set(),
        timeRemaining: 60 * 60,
        timerEndTime: null,
        timerInterval: null,
        isTimerPaused: false,
        examSubmitted: false,
        results: null,
        fontSize: 'md',
        theme: 'standard',
        mobileView: 'passage', // 'passage' | 'questions'
        highlights: { 1: [], 2: [], 3: [] },
        activeQuestionId: 1
    };

    const STORAGE_KEY_SESSION = 'ielts_active_session_v2';
    const STORAGE_KEY_CUSTOM_TEST = 'ielts_custom_test_v2';
    const STORAGE_KEY_SETTINGS = 'ielts_user_settings_v2';

    // Band score conversion table for IELTS Academic Reading (40 questions)
    function calculateIELTSBand(rawScore) {
        if (rawScore >= 39) return "9.0";
        if (rawScore >= 37) return "8.5";
        if (rawScore >= 35) return "8.0";
        if (rawScore >= 33) return "7.5";
        if (rawScore >= 30) return "7.0";
        if (rawScore >= 27) return "6.5";
        if (rawScore >= 23) return "6.0";
        if (rawScore >= 19) return "5.5";
        if (rawScore >= 15) return "5.0";
        if (rawScore >= 13) return "4.5";
        if (rawScore >= 10) return "4.0";
        if (rawScore >= 8)  return "3.5";
        if (rawScore >= 6)  return "3.0";
        if (rawScore >= 4)  return "2.5";
        return "1.0";
    }

    function getBandPerformanceAdvice(bandStr) {
        const band = parseFloat(bandStr);
        if (band >= 8.5) {
            return "Xuất sắc! Bạn có khả năng nắm bắt thông tin tinh tế, phân tích cấu trúc lập luận phức tạp và nhận diện từ đồng nghĩa thượng thừa. Hãy duy trì sự tự tin và tốc độ này trong phòng thi thật.";
        } else if (band >= 7.5) {
            return "Rất tốt! Khả năng quét từ khóa (scanning) và đọc ý chính (skimming) của bạn rất vững. Để bứt phá lên Band 8.5+, hãy tập trung vào các bẫy đảo ý (qualification traps) và các câu Yes/No/Not Given nâng cao.";
        } else if (band >= 6.5) {
            return "Khá tốt! Bạn đã đạt mức điểm mục tiêu để du học và làm việc. Tuy nhiên cần chú ý bẫy từ đồng nghĩa (synonyms) ở các bài đọc học thuật cuối (Passage 3) và tối ưu hóa thời gian phân bổ.";
        } else if (band >= 5.0) {
            return "Mức trung bình. Bạn cần trau dồi thêm vốn từ vựng học thuật, luyện thói quen gạch chân từ khóa trong câu hỏi trước khi đọc đoạn văn và tránh suy đoán thông tin trong câu hỏi True/False/Not Given.";
        } else {
            return "Bạn cần kiên trì xây dựng nền tảng từ vựng cơ bản và làm quen với cấu trúc các dạng bài thi IELTS Reading. Nên làm quen với Passage 1 trước khi chuyển sang các bài dài hơn.";
        }
    }

    // Normalization utility for tolerant string comparison
    function normalizeAnswer(str) {
        if (!str) return "";
        return str
            .toString()
            .trim()
            .toUpperCase()
            .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "") // remove punctuation
            .replace(/\s+/g, " "); // collapse multiple spaces
    }

    function checkAnswerCorrectness(userVal, questionObj) {
        if (!userVal) return false;
        const normUser = normalizeAnswer(userVal);
        const normCorrect = normalizeAnswer(questionObj.correctAnswer);

        if (normUser === normCorrect) return true;

        if (questionObj.acceptedVariants && Array.isArray(questionObj.acceptedVariants)) {
            for (let v of questionObj.acceptedVariants) {
                if (normUser === normalizeAnswer(v)) return true;
            }
        }

        // For fill in the blanks: check if student included or omitted leading article "a", "an", "the"
        const strippedUser = normUser.replace(/^(THE|A|AN)\s+/, "");
        const strippedCorrect = normCorrect.replace(/^(THE|A|AN)\s+/, "");
        if (strippedUser === strippedCorrect && strippedUser.length > 0) return true;

        return false;
    }

    // --- INITIALIZATION ---
    function init() {
        loadSettings();
        loadTestData();
        renderPassages();
        renderQuestions();
        renderFooterPalette();
        initSplitResizer();
        initHighlighter();
        initKeyboardShortcuts();
        restoreOrStartSession();
        updateUI();
    }

    function loadSettings() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY_SETTINGS);
            if (saved) {
                const parsed = JSON.parse(saved);
                AppState.fontSize = parsed.fontSize || 'md';
                AppState.theme = parsed.theme || 'standard';
                applyFontSize(AppState.fontSize, false);
                applyTheme(AppState.theme, false);
            }
        } catch (e) {
            console.warn("Failed to load settings:", e);
        }
    }

    function saveSettings() {
        try {
            localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify({
                fontSize: AppState.fontSize,
                theme: AppState.theme
            }));
        } catch (e) {}
    }

    function loadTestData() {
        try {
            const custom = localStorage.getItem(STORAGE_KEY_CUSTOM_TEST);
            if (custom) {
                const parsed = JSON.parse(custom);
                if (parsed.passages && parsed.questions && parsed.questions.length > 0) {
                    AppState.testData = parsed;
                    return;
                }
            }
        } catch (e) {
            console.warn("Failed to load custom test, using default:", e);
        }
        AppState.testData = DEFAULT_TEST_DATA;
    }

    // --- RENDER PASSAGES ---
    function renderPassages() {
        const container = document.getElementById('passage-content-area');
        if (!container) return;
        container.innerHTML = '';

        AppState.testData.passages.forEach(passage => {
            const article = document.createElement('article');
            article.id = `passage-article-${passage.id}`;
            article.className = `passage-item ${passage.id === AppState.currentPassage ? '' : 'hidden'} space-y-4 text-slate-800 leading-relaxed`;

            let html = `
                <div class="border-b border-slate-200 pb-3 mb-4">
                    <div class="flex items-center justify-between">
                        <span class="text-xs font-bold text-blue-600 uppercase tracking-widest">Reading Passage ${passage.number}</span>
                        <span class="text-xs text-slate-500 font-medium">You should spend about 20 minutes on this passage</span>
                    </div>
                    <h1 class="text-2xl font-extrabold text-slate-900 mt-1">${passage.title}</h1>
                    ${passage.subtitle ? `<p class="italic text-slate-600 text-sm mt-1">${passage.subtitle}</p>` : ''}
                </div>
            `;

            passage.paragraphs.forEach(p => {
                const labelHtml = p.label && isNaN(p.label) ? `<span class="font-bold text-blue-800 mr-2 bg-blue-50 px-2 py-0.5 rounded text-sm">${p.label}</span>` : '';
                html += `
                    <p id="${p.id}" class="passage-paragraph relative hover:bg-slate-50/50 p-1.5 rounded transition">
                        ${labelHtml}${p.text}
                    </p>
                `;
            });

            if (passage.footnotes && passage.footnotes.length > 0) {
                html += `<div class="border-t border-dashed border-slate-200 pt-3 mt-6 text-xs text-slate-500 space-y-1">`;
                passage.footnotes.forEach(fn => {
                    html += `<p>${fn}</p>`;
                });
                html += `</div>`;
            }

            article.innerHTML = html;
            container.appendChild(article);
        });
    }

    // --- RENDER QUESTIONS ---
    function renderQuestions() {
        const container = document.getElementById('questions-content-area');
        if (!container) return;
        container.innerHTML = '';

        [1, 2, 3].forEach(passageNum => {
            const groupDiv = document.createElement('div');
            groupDiv.id = `questions-group-${passageNum}`;
            groupDiv.className = `questions-group-item ${passageNum === AppState.currentPassage ? '' : 'hidden'} space-y-6`;

            const passageQuestions = AppState.testData.questions.filter(q => q.passageId === passageNum);

            // Group questions by sectionTitle
            let currentSectionTitle = "";
            let sectionBlock = null;

            passageQuestions.forEach(q => {
                if (q.sectionTitle && q.sectionTitle !== currentSectionTitle) {
                    currentSectionTitle = q.sectionTitle;
                    sectionBlock = document.createElement('div');
                    sectionBlock.className = "bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4 mb-6";
                    sectionBlock.innerHTML = `
                        <div class="border-b border-slate-200 pb-2">
                            <h2 class="text-lg font-bold text-slate-800">${q.sectionTitle}</h2>
                            <p class="text-xs text-slate-600 font-medium mt-0.5">${q.instruction || ""}</p>
                        </div>
                        <div class="space-y-4 question-list-inner"></div>
                    `;
                    groupDiv.appendChild(sectionBlock);
                }

                const listInner = sectionBlock ? sectionBlock.querySelector('.question-list-inner') : groupDiv;
                const card = createQuestionCard(q);
                listInner.appendChild(card);
            });

            container.appendChild(groupDiv);
        });
    }

    function createQuestionCard(q) {
        const card = document.createElement('div');
        card.id = `q-card-${q.id}`;
        card.className = "question-card p-3.5 rounded-lg border border-slate-200 bg-slate-50/60 hover:bg-slate-50 transition space-y-2";

        const isFlagged = AppState.flaggedQuestions.has(q.id);
        const currentAnswer = AppState.userAnswers[q.id] || "";

        let bodyHtml = "";

        if (q.type === 'text') {
            bodyHtml = `
                <div class="text-sm text-slate-800 flex flex-wrap items-center gap-2">
                    <span class="font-bold text-blue-600">Question ${q.id}:</span>
                    <span>${q.prefix || ""}</span>
                    <input type="text" id="input-q-${q.id}" data-qid="${q.id}" value="${escapeHtml(currentAnswer)}"
                        class="border border-slate-300 rounded px-2.5 py-1 text-sm font-semibold text-slate-800 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none uppercase text-center min-w-[140px] max-w-[240px]"
                        placeholder="Type answer...">
                    <span>${q.suffix || ""}</span>
                </div>
            `;
        } else if (q.type === 'select') {
            const options = q.options || ["TRUE", "FALSE", "NOT GIVEN"];
            let optHtml = `<option value="">-- Select option --</option>`;
            options.forEach(opt => {
                optHtml += `<option value="${opt}" ${currentAnswer === opt ? 'selected' : ''}>${opt}</option>`;
            });

            bodyHtml = `
                <div class="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                    <div class="text-sm text-slate-800 flex-1">
                        <span class="font-bold text-blue-600 mr-1.5">${q.id}.</span> ${q.statement}
                    </div>
                    <div class="shrink-0">
                        <select id="select-q-${q.id}" data-qid="${q.id}"
                            class="border border-slate-300 rounded px-2.5 py-1.5 text-xs font-bold text-slate-700 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
                            ${optHtml}
                        </select>
                    </div>
                </div>
            `;
        } else if (q.type === 'radio-group') {
            const options = q.options || ["A", "B", "C", "D", "E", "F"];
            let radioCols = "";
            options.forEach(opt => {
                radioCols += `
                    <label class="flex items-center space-x-1 cursor-pointer px-2 py-1 rounded hover:bg-blue-50 text-xs font-semibold">
                        <input type="radio" name="radio-q-${q.id}" value="${opt}" ${currentAnswer === opt ? 'checked' : ''} data-qid="${q.id}" class="text-blue-600 focus:ring-blue-500">
                        <span>${opt}</span>
                    </label>
                `;
            });

            bodyHtml = `
                <div class="space-y-2">
                    <div class="text-sm text-slate-800">
                        <span class="font-bold text-blue-600 mr-1.5">${q.id}.</span> ${q.statement}
                    </div>
                    <div class="flex flex-wrap gap-2 pt-1 border-t border-slate-200">
                        ${radioCols}
                    </div>
                </div>
            `;
        } else if (q.type === 'select-people') {
            const people = q.options || [];
            let optHtml = `<option value="">-- Select person --</option>`;
            people.forEach(p => {
                optHtml += `<option value="${p.code}" ${currentAnswer === p.code ? 'selected' : ''}>${p.code}. ${p.name}</option>`;
            });

            bodyHtml = `
                <div class="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                    <div class="text-sm text-slate-800 flex-1">
                        <span class="font-bold text-blue-600 mr-1.5">${q.id}.</span> ${q.statement}
                    </div>
                    <div class="shrink-0">
                        <select id="select-q-${q.id}" data-qid="${q.id}"
                            class="border border-slate-300 rounded px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none max-w-[200px]">
                            ${optHtml}
                        </select>
                    </div>
                </div>
            `;
        } else if (q.type === 'multiple-choice') {
            let choicesHtml = "";
            (q.options || []).forEach(opt => {
                choicesHtml += `
                    <label class="flex items-start space-x-2.5 cursor-pointer p-1.5 rounded hover:bg-blue-50 transition text-sm">
                        <input type="radio" name="radio-q-${q.id}" value="${opt.letter}" ${currentAnswer === opt.letter ? 'checked' : ''} data-qid="${q.id}" class="mt-1 text-blue-600 focus:ring-blue-500">
                        <span class="text-slate-700"><strong class="text-blue-700">${opt.letter}.</strong> ${opt.text}</span>
                    </label>
                `;
            });

            bodyHtml = `
                <div class="space-y-2.5">
                    <div class="text-sm font-semibold text-slate-800">
                        <span class="font-bold text-blue-600 mr-1.5">${q.id}.</span> ${q.statement}
                    </div>
                    <div class="pl-2 space-y-1.5">
                        ${choicesHtml}
                    </div>
                </div>
            `;
        } else if (q.type === 'summary-select') {
            const boxOpts = q.boxOptions || [];
            let optHtml = `<option value="">-- Select word --</option>`;
            boxOpts.forEach(b => {
                optHtml += `<option value="${b.letter}" ${currentAnswer === b.letter ? 'selected' : ''}>${b.letter}. ${b.word}</option>`;
            });

            bodyHtml = `
                <div class="text-sm text-slate-800 flex flex-wrap items-center gap-2">
                    <span class="font-bold text-blue-600">Question ${q.id}:</span>
                    <span>${q.statementPrefix || ""}</span>
                    <select id="select-q-${q.id}" data-qid="${q.id}"
                        class="border border-slate-300 rounded px-2.5 py-1 text-xs font-bold text-blue-700 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
                        ${optHtml}
                    </select>
                    <span>${q.statementSuffix || ""}</span>
                </div>
            `;
        }

        card.innerHTML = `
            <div class="flex items-center justify-between border-b border-slate-200/60 pb-1 mb-2 text-xs">
                <span class="font-bold text-slate-500 uppercase tracking-wider">Question ${q.id}</span>
                <button type="button" class="btn-flag text-[11px] font-semibold flex items-center gap-1 ${isFlagged ? 'text-amber-600' : 'text-slate-400 hover:text-slate-600'}" data-qid="${q.id}">
                    <svg class="w-3.5 h-3.5 ${isFlagged ? 'fill-current text-amber-500' : 'stroke-current'}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
                    </svg>
                    <span>${isFlagged ? 'Flagged' : 'Review'}</span>
                </button>
            </div>
            ${bodyHtml}
        `;

        // Attach events
        const inputs = card.querySelectorAll('input, select');
        inputs.forEach(el => {
            el.addEventListener('change', () => onAnswerChanged(q.id));
            if (el.tagName === 'INPUT' && el.type === 'text') {
                el.addEventListener('input', () => onAnswerChanged(q.id));
            }
            el.addEventListener('focus', () => {
                setActiveQuestion(q.id);
            });
        });

        const flagBtn = card.querySelector('.btn-flag');
        if (flagBtn) {
            flagBtn.addEventListener('click', () => toggleFlag(q.id));
        }

        return card;
    }

    // --- RENDER FOOTER PALETTE ---
    function renderFooterPalette() {
        const p1Container = document.getElementById('palette-p1');
        const p2Container = document.getElementById('palette-p2');
        const p3Container = document.getElementById('palette-p3');

        if (!p1Container || !p2Container || !p3Container) return;

        p1Container.innerHTML = '';
        p2Container.innerHTML = '';
        p3Container.innerHTML = '';

        AppState.testData.questions.forEach(q => {
            const btn = document.createElement('button');
            btn.id = `palette-btn-${q.id}`;
            btn.className = `q-pill ${AppState.activeQuestionId === q.id ? 'active' : ''} ${hasAnswer(q.id) ? 'answered' : ''} ${AppState.flaggedQuestions.has(q.id) ? 'flagged' : ''}`;
            btn.textContent = q.id;
            btn.title = `Jump to Question ${q.id}`;
            btn.setAttribute('aria-label', `Question ${q.id}`);

            btn.addEventListener('click', () => {
                jumpToQuestion(q.id);
            });

            if (q.passageId === 1) p1Container.appendChild(btn);
            else if (q.passageId === 2) p2Container.appendChild(btn);
            else p3Container.appendChild(btn);
        });
    }

    function hasAnswer(qId) {
        const val = AppState.userAnswers[qId];
        return val !== undefined && val !== null && val.toString().trim() !== "";
    }

    function onAnswerChanged(qId) {
        let val = "";
        const textInput = document.getElementById(`input-q-${qId}`);
        const select = document.getElementById(`select-q-${qId}`);
        const radio = document.querySelector(`input[name="radio-q-${qId}"]:checked`);

        if (textInput) val = textInput.value;
        else if (select) val = select.value;
        else if (radio) val = radio.value;

        AppState.userAnswers[qId] = val;
        updatePaletteButton(qId);
        scheduleAutosave();
    }

    function toggleFlag(qId) {
        if (AppState.flaggedQuestions.has(qId)) {
            AppState.flaggedQuestions.delete(qId);
        } else {
            AppState.flaggedQuestions.add(qId);
        }

        // Update card button UI
        const card = document.getElementById(`q-card-${qId}`);
        if (card) {
            const flagBtn = card.querySelector('.btn-flag');
            const isFlagged = AppState.flaggedQuestions.has(qId);
            if (flagBtn) {
                flagBtn.className = `btn-flag text-[11px] font-semibold flex items-center gap-1 ${isFlagged ? 'text-amber-600' : 'text-slate-400 hover:text-slate-600'}`;
                flagBtn.querySelector('svg').className = `w-3.5 h-3.5 ${isFlagged ? 'fill-current text-amber-500' : 'stroke-current'}`;
                flagBtn.querySelector('span').textContent = isFlagged ? 'Flagged' : 'Review';
            }
        }

        updatePaletteButton(qId);
        scheduleAutosave();
    }

    function updatePaletteButton(qId) {
        const btn = document.getElementById(`palette-btn-${qId}`);
        if (!btn) return;

        if (hasAnswer(qId)) btn.classList.add('answered');
        else btn.classList.remove('answered');

        if (AppState.flaggedQuestions.has(qId)) btn.classList.add('flagged');
        else btn.classList.remove('flagged');

        if (AppState.activeQuestionId === qId) btn.classList.add('active');
        else btn.classList.remove('active');
    }

    function setActiveQuestion(qId) {
        AppState.activeQuestionId = qId;
        document.querySelectorAll('.q-pill').forEach(b => b.classList.remove('active'));
        const btn = document.getElementById(`palette-btn-${qId}`);
        if (btn) btn.classList.add('active');
    }

    function jumpToQuestion(qId) {
        const qObj = AppState.testData.questions.find(q => q.id === qId);
        if (!qObj) return;

        if (qObj.passageId !== AppState.currentPassage) {
            switchPassage(qObj.passageId);
        }

        setActiveQuestion(qId);

        if (window.innerWidth <= 900 && AppState.mobileView !== 'questions') {
            setMobileView('questions');
        }

        setTimeout(() => {
            const card = document.getElementById(`q-card-${qId}`);
            if (card) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.classList.add('highlighted-box');
                setTimeout(() => card.classList.remove('highlighted-box'), 1600);

                const focusable = card.querySelector('input, select');
                if (focusable) focusable.focus();
            }
        }, 150);
    }

    // --- PASSAGE NAVIGATION ---
    function switchPassage(passageNum) {
        if (passageNum < 1 || passageNum > 3) return;
        AppState.currentPassage = passageNum;

        // Update passage tabs
        for (let i = 1; i <= 3; i++) {
            const tab = document.getElementById(`tab-passage-${i}`);
            if (tab) {
                if (i === passageNum) {
                    tab.classList.remove('bg-slate-100', 'text-slate-700', 'hover:bg-slate-200');
                    tab.classList.add('bg-blue-600', 'text-white', 'shadow-sm');
                } else {
                    tab.classList.remove('bg-blue-600', 'text-white', 'shadow-sm');
                    tab.classList.add('bg-slate-100', 'text-slate-700', 'hover:bg-slate-200');
                }
            }
        }

        // Toggle articles
        document.querySelectorAll('.passage-item').forEach(el => el.classList.add('hidden'));
        const currentArt = document.getElementById(`passage-article-${passageNum}`);
        if (currentArt) currentArt.classList.remove('hidden');

        // Toggle question groups
        document.querySelectorAll('.questions-group-item').forEach(el => el.classList.add('hidden'));
        const currentQGroup = document.getElementById(`questions-group-${passageNum}`);
        if (currentQGroup) currentQGroup.classList.remove('hidden');

        // Reset scroll
        const passagePane = document.getElementById('passage-scroll-pane');
        const questionsPane = document.getElementById('questions-scroll-pane');
        if (passagePane) passagePane.scrollTop = 0;
        if (questionsPane) questionsPane.scrollTop = 0;

        scheduleAutosave();
    }

    // --- RESIZABLE SPLIT PANE ---
    function initSplitResizer() {
        const gutter = document.getElementById('split-gutter');
        const passagePane = document.getElementById('passage-scroll-pane');
        const splitContainer = document.getElementById('workspace-split');

        if (!gutter || !passagePane || !splitContainer) return;

        let isResizing = false;

        const savedWidth = localStorage.getItem('ielts_split_width');
        if (savedWidth) {
            passagePane.style.width = savedWidth;
        }

        function onMouseDown(e) {
            isResizing = true;
            gutter.classList.add('resizing');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        }

        function onMouseMove(e) {
            if (!isResizing) return;
            const containerRect = splitContainer.getBoundingClientRect();
            let newWidth = e.clientX - containerRect.left;
            const minW = 280;
            const maxW = containerRect.width - 320;

            if (newWidth < minW) newWidth = minW;
            if (newWidth > maxW) newWidth = maxW;

            const percent = (newWidth / containerRect.width) * 100;
            passagePane.style.width = `${percent}%`;
        }

        function onMouseUp() {
            if (isResizing) {
                isResizing = false;
                gutter.classList.remove('resizing');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                localStorage.setItem('ielts_split_width', passagePane.style.width);
            }
        }

        gutter.addEventListener('mousedown', onMouseDown);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);

        // Double click to reset to 50%
        gutter.addEventListener('dblclick', () => {
            passagePane.style.width = '50%';
            localStorage.setItem('ielts_split_width', '50%');
        });
    }

    // --- ACCESSIBLE, ROBUST HIGHLIGHTER ---
    function initHighlighter() {
        const passagePane = document.getElementById('passage-scroll-pane');
        const tooltip = document.getElementById('highlight-toolbar');
        if (!passagePane || !tooltip) return;

        let activeRange = null;

        passagePane.addEventListener('mouseup', () => {
            const sel = window.getSelection();
            if (!sel || sel.isCollapsed) {
                tooltip.classList.add('hidden');
                return;
            }

            const selectedText = sel.toString().trim();
            if (selectedText.length < 2) {
                tooltip.classList.add('hidden');
                return;
            }

            try {
                activeRange = sel.getRangeAt(0);
                const rect = activeRange.getBoundingClientRect();
                tooltip.style.top = `${rect.top + window.scrollY - 38}px`;
                tooltip.style.left = `${rect.left + window.scrollX + (rect.width / 2) - 60}px`;
                tooltip.classList.remove('hidden');
            } catch (e) {
                tooltip.classList.add('hidden');
            }
        });

        document.addEventListener('mousedown', (e) => {
            if (!tooltip.contains(e.target) && !passagePane.contains(e.target)) {
                tooltip.classList.add('hidden');
            }
        });

        const btnYellow = document.getElementById('hl-btn-yellow');
        const btnBlue = document.getElementById('hl-btn-blue');
        const btnClear = document.getElementById('hl-btn-clear');

        if (btnYellow) {
            btnYellow.addEventListener('click', () => applyHighlightSafe('ielts-highlight'));
        }
        if (btnBlue) {
            btnBlue.addEventListener('click', () => applyHighlightSafe('ielts-highlight ielts-highlight-blue'));
        }
        if (btnClear) {
            btnClear.addEventListener('click', () => removeSelectedHighlight());
        }

        function applyHighlightSafe(className) {
            if (!activeRange) return;
            try {
                // If selection is single text node
                if (activeRange.startContainer === activeRange.endContainer && activeRange.startContainer.nodeType === Node.TEXT_NODE) {
                    const span = document.createElement('span');
                    span.className = className;
                    span.title = 'Click to remove highlight';
                    span.onclick = function() {
                        const tn = document.createTextNode(this.textContent);
                        this.parentNode.replaceChild(tn, this);
                        scheduleAutosave();
                    };
                    activeRange.surroundContents(span);
                } else {
                    // Selection spans multiple nodes: extract and wrap in document fragment
                    const span = document.createElement('span');
                    span.className = className;
                    span.title = 'Click to remove highlight';
                    span.onclick = function() {
                        const tn = document.createTextNode(this.textContent);
                        this.parentNode.replaceChild(tn, this);
                        scheduleAutosave();
                    };
                    span.appendChild(activeRange.extractContents());
                    activeRange.insertNode(span);
                }
                window.getSelection().removeAllRanges();
                tooltip.classList.add('hidden');
                scheduleAutosave();
            } catch (err) {
                console.warn("Could not wrap cross-boundary nodes:", err);
                tooltip.classList.add('hidden');
            }
        }

        function removeSelectedHighlight() {
            if (!activeRange) return;
            const container = activeRange.commonAncestorContainer;
            const hlEl = container.nodeType === Node.ELEMENT_NODE ? container.closest('.ielts-highlight') : container.parentElement.closest('.ielts-highlight');
            if (hlEl) {
                const tn = document.createTextNode(hlEl.textContent);
                hlEl.parentNode.replaceChild(tn, hlEl);
                tooltip.classList.add('hidden');
                scheduleAutosave();
            }
        }
    }

    // --- WALL-CLOCK TIMER ENGINE ---
    function startTimer(durationSeconds) {
        clearInterval(AppState.timerInterval);

        const now = Date.now();
        AppState.timerEndTime = now + (durationSeconds * 1000);

        updateTimerDisplay();

        AppState.timerInterval = setInterval(() => {
            if (AppState.examSubmitted || AppState.isTimerPaused) return;

            const remaining = Math.max(0, Math.round((AppState.timerEndTime - Date.now()) / 1000));
            AppState.timeRemaining = remaining;
            updateTimerDisplay();

            if (remaining <= 0) {
                clearInterval(AppState.timerInterval);
                onTimeExpired();
            }
        }, 1000);
    }

    function updateTimerDisplay() {
        const timerEl = document.getElementById('timer-display');
        if (!timerEl) return;

        const mins = Math.floor(AppState.timeRemaining / 60);
        const secs = AppState.timeRemaining % 60;
        timerEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

        if (AppState.timeRemaining <= 300) {
            timerEl.classList.remove('text-yellow-400', 'text-slate-200');
            timerEl.classList.add('text-rose-500', 'animate-pulse');
        } else if (AppState.timeRemaining <= 600) {
            timerEl.classList.remove('text-slate-200', 'text-rose-500');
            timerEl.classList.add('text-yellow-400');
        } else {
            timerEl.classList.remove('text-rose-500', 'animate-pulse');
            timerEl.classList.add('text-yellow-400');
        }
    }

    function onTimeExpired() {
        showToast("Hết giờ làm bài thi! Hệ thống đang tự động tổng hợp kết quả...", "warning");
        submitExam();
    }

    // --- AUTOSAVE & RESTORE ---
    let autosaveTimer = null;
    function scheduleAutosave() {
        clearTimeout(autosaveTimer);
        autosaveTimer = setTimeout(() => {
            saveSession();
        }, 400);
    }

    function saveSession() {
        if (AppState.examSubmitted) return;
        try {
            const data = {
                testId: AppState.testData.id,
                currentPassage: AppState.currentPassage,
                userAnswers: AppState.userAnswers,
                flaggedQuestions: Array.from(AppState.flaggedQuestions),
                timeRemaining: AppState.timeRemaining,
                savedAt: Date.now()
            };
            localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(data));
            const statusIndicator = document.getElementById('autosave-status');
            if (statusIndicator) {
                statusIndicator.textContent = "Saved";
                statusIndicator.classList.remove('text-slate-400');
                statusIndicator.classList.add('text-emerald-400');
                setTimeout(() => {
                    statusIndicator.classList.remove('text-emerald-400');
                    statusIndicator.classList.add('text-slate-400');
                }, 1200);
            }
        } catch (e) {
            console.warn("Failed to save session:", e);
        }
    }

    function restoreOrStartSession() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY_SESSION);
            if (raw) {
                const session = JSON.parse(raw);
                if (session && session.testId === AppState.testData.id && session.userAnswers) {
                    AppState.userAnswers = session.userAnswers || {};
                    AppState.flaggedQuestions = new Set(session.flaggedQuestions || []);
                    AppState.currentPassage = session.currentPassage || 1;

                    // Restore time remaining if valid
                    if (session.timeRemaining && session.timeRemaining > 0) {
                        AppState.timeRemaining = session.timeRemaining;
                    }

                    showToast("Phiên làm bài đã được tự động khôi phục từ trình duyệt.", "info");
                }
            }
        } catch (e) {
            console.warn("Could not restore session:", e);
        }

        startTimer(AppState.timeRemaining);
        switchPassage(AppState.currentPassage);
    }

    function clearSession() {
        localStorage.removeItem(STORAGE_KEY_SESSION);
        AppState.userAnswers = {};
        AppState.flaggedQuestions.clear();
        AppState.timeRemaining = (AppState.testData.durationMinutes || 60) * 60;
        AppState.examSubmitted = false;
        AppState.results = null;

        // Re-render
        renderQuestions();
        renderFooterPalette();
        startTimer(AppState.timeRemaining);
        switchPassage(1);
        showToast("Đã thiết lập lại bài thi mới.", "info");
    }

    // --- SUBMISSION & RESULTS REVIEW ---
    function openSubmitModal() {
        let answeredCount = 0;
        const unanswered = [];

        AppState.testData.questions.forEach(q => {
            if (hasAnswer(q.id)) answeredCount++;
            else unanswered.push(q.id);
        });

        document.getElementById('modal-answered-count').textContent = answeredCount;
        document.getElementById('modal-unanswered-count').textContent = unanswered.length;

        const listEl = document.getElementById('modal-unanswered-list');
        listEl.innerHTML = '';
        if (unanswered.length === 0) {
            listEl.innerHTML = '<span class="text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-md border border-emerald-200">Hoàn hảo! Bạn đã điền đủ 40/40 câu hỏi.</span>';
        } else {
            unanswered.forEach(qId => {
                const btn = document.createElement('button');
                btn.className = "px-2 py-1 text-xs border border-amber-300 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold transition";
                btn.textContent = `Q${qId}`;
                btn.onclick = () => {
                    closeModal('submit-confirm-modal');
                    jumpToQuestion(qId);
                };
                listEl.appendChild(btn);
            });
        }

        openModal('submit-confirm-modal');
    }

    function submitExam() {
        closeModal('submit-confirm-modal');
        clearInterval(AppState.timerInterval);
        AppState.examSubmitted = true;

        let correct = 0;
        const breakdown = [];

        AppState.testData.questions.forEach(q => {
            const userVal = AppState.userAnswers[q.id] || "";
            const isCorrect = checkAnswerCorrectness(userVal, q);
            if (isCorrect) correct++;

            breakdown.push({
                question: q,
                userAnswer: userVal,
                isCorrect: isCorrect,
                isFlagged: AppState.flaggedQuestions.has(q.id)
            });
        });

        const total = AppState.testData.questions.length;
        const band = calculateIELTSBand(correct);
        AppState.results = {
            rawScore: correct,
            totalQuestions: total,
            bandScore: band,
            breakdown: breakdown
        };

        localStorage.removeItem(STORAGE_KEY_SESSION);
        renderResultsDashboard();
        openModal('results-review-modal');
    }

    function renderResultsDashboard(filter = 'all') {
        if (!AppState.results) return;

        const r = AppState.results;
        document.getElementById('res-raw-score').textContent = `${r.rawScore} / ${r.totalQuestions}`;
        document.getElementById('res-band-score').textContent = r.bandScore;
        document.getElementById('res-advice-text').textContent = getBandPerformanceAdvice(r.bandScore);

        // Update counts
        const incorrectCount = r.totalQuestions - r.rawScore;
        const flaggedCount = r.breakdown.filter(b => b.isFlagged).length;

        const filterAllBtn = document.getElementById('filter-all-btn');
        const filterCorrectBtn = document.getElementById('filter-correct-btn');
        const filterIncorrectBtn = document.getElementById('filter-incorrect-btn');
        const filterFlaggedBtn = document.getElementById('filter-flagged-btn');

        if (filterAllBtn) filterAllBtn.textContent = `All (${r.totalQuestions})`;
        if (filterCorrectBtn) filterCorrectBtn.textContent = `Correct (${r.rawScore})`;
        if (filterIncorrectBtn) filterIncorrectBtn.textContent = `Incorrect (${incorrectCount})`;
        if (filterFlaggedBtn) filterFlaggedBtn.textContent = `Flagged (${flaggedCount})`;

        const grid = document.getElementById('results-breakdown-container');
        grid.innerHTML = '';

        const filtered = r.breakdown.filter(item => {
            if (filter === 'correct') return item.isCorrect;
            if (filter === 'incorrect') return !item.isCorrect;
            if (filter === 'flagged') return item.isFlagged;
            return true;
        });

        if (filtered.length === 0) {
            grid.innerHTML = `<div class="p-6 text-center text-sm text-slate-500">No questions match this filter.</div>`;
            return;
        }

        filtered.forEach(item => {
            const q = item.question;
            const card = document.createElement('div');
            card.className = `p-4 rounded-xl border ${item.isCorrect ? 'bg-emerald-50/40 border-emerald-200' : 'bg-rose-50/40 border-rose-200'} space-y-3 transition`;

            let displayUserAns = item.userAnswer ? escapeHtml(item.userAnswer) : '<span class="italic text-slate-400">[Blank / Not answered]</span>';
            let displayCorrect = escapeHtml(q.correctAnswer);
            if (q.acceptedVariants && q.acceptedVariants.length > 1) {
                displayCorrect += ` <span class="text-xs text-slate-500 font-normal">(also accepted: ${q.acceptedVariants.join(", ")})</span>`;
            }

            card.innerHTML = `
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <span class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${item.isCorrect ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}">
                            ${item.isCorrect ? '✓' : '✗'}
                        </span>
                        <span class="font-bold text-slate-800 text-sm">Question ${q.id}</span>
                        <span class="text-xs text-slate-500">(${q.paragraphRef || 'Passage reference'})</span>
                    </div>
                    ${item.isFlagged ? `<span class="text-[11px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded">Flagged</span>` : ''}
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div class="p-2 rounded bg-white border border-slate-200">
                        <span class="text-slate-500 block">Your Answer:</span>
                        <span class="font-bold ${item.isCorrect ? 'text-emerald-700' : 'text-rose-700'}">${displayUserAns}</span>
                    </div>
                    <div class="p-2 rounded bg-white border border-slate-200">
                        <span class="text-slate-500 block">Correct Answer:</span>
                        <span class="font-bold text-slate-800">${displayCorrect}</span>
                    </div>
                </div>

                <div class="text-xs bg-white/80 p-3 rounded-lg border border-slate-200/80 space-y-1.5">
                    <div class="text-slate-700 font-medium">
                        <span class="font-bold text-blue-700">Evidence from Passage:</span> 
                        <blockquote class="border-l-2 border-blue-400 pl-2 my-1 italic text-slate-600">"${escapeHtml(q.evidenceQuote || "See passage text.")}"</blockquote>
                    </div>
                    <div class="text-slate-700 pt-1">
                        <span class="font-bold text-slate-800">Explanation:</span> ${escapeHtml(q.explanation || "No explanation provided.")}
                    </div>
                </div>

                <div class="flex justify-end pt-1">
                    <button class="btn-locate-passage text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1" data-qid="${q.id}">
                        <span>Locate in Passage</span>
                        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                    </button>
                </div>
            `;

            const locateBtn = card.querySelector('.btn-locate-passage');
            if (locateBtn) {
                locateBtn.addEventListener('click', () => {
                    locateQuestionInPassage(q);
                });
            }

            grid.appendChild(card);
        });
    }

    function locateQuestionInPassage(q) {
        closeModal('results-review-modal');
        switchPassage(q.passageId);

        setTimeout(() => {
            let target = null;
            // Try to find paragraph by matching text or paragraph label
            const paragraphs = document.querySelectorAll(`#passage-article-${q.passageId} .passage-paragraph`);
            if (q.evidenceQuote) {
                for (let p of paragraphs) {
                    if (p.textContent.includes(q.evidenceQuote.substring(0, 25))) {
                        target = p;
                        break;
                    }
                }
            }

            if (!target && paragraphs.length > 0) {
                target = paragraphs[0];
            }

            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                target.classList.add('ielts-evidence-flash');
                setTimeout(() => target.classList.remove('ielts-evidence-flash'), 2500);
            }
        }, 200);
    }

    // --- TUTOR MODE & TEST MANAGEMENT ---
    function openTutorManager() {
        const jsonArea = document.getElementById('tutor-json-export');
        if (jsonArea) {
            jsonArea.value = JSON.stringify(AppState.testData, null, 2);
        }
        openModal('tutor-modal');
    }

    function exportTestJSON() {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(AppState.testData, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `${AppState.testData.id || 'ielts-test'}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        showToast("Đã tải xuống file đề thi JSON.", "success");
    }

    function importTestJSON() {
        const jsonArea = document.getElementById('tutor-json-export');
        if (!jsonArea) return;
        try {
            const parsed = JSON.parse(jsonArea.value.trim());
            if (!parsed.passages || !Array.isArray(parsed.passages) || parsed.passages.length === 0) {
                throw new Error("Cấu trúc đề thiếu danh sách passages hợp lệ.");
            }
            if (!parsed.questions || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
                throw new Error("Cấu trúc đề thiếu danh sách questions hợp lệ.");
            }

            // Save custom test
            localStorage.setItem(STORAGE_KEY_CUSTOM_TEST, JSON.stringify(parsed));
            AppState.testData = parsed;

            // Re-render
            renderPassages();
            renderQuestions();
            renderFooterPalette();
            clearSession();
            closeModal('tutor-modal');
            showToast("Đã tải thành công đề thi tùy chỉnh mới!", "success");
        } catch (err) {
            alert("Lỗi nhập dữ liệu JSON: " + err.message);
        }
    }

    function resetToDefaultTest() {
        if (confirm("Khôi phục về đề thi gốc Cambridge 11 Test 1?")) {
            localStorage.removeItem(STORAGE_KEY_CUSTOM_TEST);
            AppState.testData = DEFAULT_TEST_DATA;
            renderPassages();
            renderQuestions();
            renderFooterPalette();
            clearSession();
            closeModal('tutor-modal');
            showToast("Đã khôi phục về đề Cambridge 11 Test 1.", "info");
        }
    }

    // --- FONT SIZE & THEME CONTROLS ---
    function applyFontSize(size, notify = true) {
        AppState.fontSize = size;
        const body = document.body;
        body.classList.remove('font-scale-sm', 'font-scale-md', 'font-scale-lg', 'font-scale-xl');
        body.classList.add(`font-scale-${size}`);

        ['sm', 'md', 'lg', 'xl'].forEach(s => {
            const btn = document.getElementById(`btn-font-${s}`);
            if (btn) {
                if (s === size) {
                    btn.classList.add('bg-blue-600', 'text-white');
                    btn.classList.remove('bg-slate-100', 'text-slate-700');
                } else {
                    btn.classList.remove('bg-blue-600', 'text-white');
                    btn.classList.add('bg-slate-100', 'text-slate-700');
                }
            }
        });

        saveSettings();
        if (notify) showToast(`Font size: ${size.toUpperCase()}`, "info");
    }

    function applyTheme(theme, notify = true) {
        AppState.theme = theme;
        const body = document.body;
        body.classList.remove('theme-high-contrast-dark', 'theme-yellow-on-black');
        if (theme === 'contrast-dark') {
            body.classList.add('theme-high-contrast-dark');
        } else if (theme === 'yellow-black') {
            body.classList.add('theme-yellow-on-black');
        }
        saveSettings();
        if (notify) showToast(`Theme updated: ${theme}`, "info");
    }

    // --- MOBILE VIEW CONTROLS ---
    function setMobileView(view) {
        AppState.mobileView = view;
        const passagePane = document.getElementById('passage-scroll-pane');
        const questionsPane = document.getElementById('questions-scroll-pane');
        const btnPassage = document.getElementById('mobile-btn-passage');
        const btnQuestions = document.getElementById('mobile-btn-questions');

        if (!passagePane || !questionsPane) return;

        if (view === 'passage') {
            passagePane.classList.remove('hidden-mobile');
            questionsPane.classList.add('hidden-mobile');
            if (btnPassage) {
                btnPassage.classList.add('bg-blue-600', 'text-white');
                btnPassage.classList.remove('bg-slate-100', 'text-slate-700');
            }
            if (btnQuestions) {
                btnQuestions.classList.remove('bg-blue-600', 'text-white');
                btnQuestions.classList.add('bg-slate-100', 'text-slate-700');
            }
        } else {
            passagePane.classList.add('hidden-mobile');
            questionsPane.classList.remove('hidden-mobile');
            if (btnQuestions) {
                btnQuestions.classList.add('bg-blue-600', 'text-white');
                btnQuestions.classList.remove('bg-slate-100', 'text-slate-700');
            }
            if (btnPassage) {
                btnPassage.classList.remove('bg-blue-600', 'text-white');
                btnPassage.classList.add('bg-slate-100', 'text-slate-700');
            }
        }
    }

    // --- KEYBOARD SHORTCUTS ---
    function initKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ignore if typing inside input / textarea
            const targetTag = e.target.tagName;
            const isTyping = (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT');

            if (e.key === 'Escape') {
                closeAllModals();
                return;
            }

            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                openSubmitModal();
                return;
            }

            if (e.altKey && (e.key === '1' || e.key === '2' || e.key === '3')) {
                e.preventDefault();
                switchPassage(parseInt(e.key));
                return;
            }

            if (e.altKey && (e.key === 'f' || e.key === 'F')) {
                e.preventDefault();
                if (AppState.activeQuestionId) {
                    toggleFlag(AppState.activeQuestionId);
                }
                return;
            }

            if (!isTyping && e.key === '?') {
                openModal('shortcuts-modal');
            }
        });
    }

    // --- MODAL UTILITIES ---
    function openModal(id) {
        const modal = document.getElementById(id);
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            document.body.style.overflow = 'hidden';
        }
    }

    function closeModal(id) {
        const modal = document.getElementById(id);
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            document.body.style.overflow = '';
        }
    }

    function closeAllModals() {
        document.querySelectorAll('.modal-backdrop').forEach(m => {
            m.classList.add('hidden');
            m.classList.remove('flex');
        });
        document.body.style.overflow = '';
    }

    // --- TOAST NOTIFICATIONS ---
    function showToast(message, type = 'info') {
        const toast = document.getElementById('toast-notification');
        if (!toast) return;

        const colors = {
            info: 'bg-slate-800 text-white',
            success: 'bg-emerald-600 text-white',
            warning: 'bg-amber-600 text-white',
            error: 'bg-rose-600 text-white'
        };

        toast.className = `fixed bottom-16 right-6 z-50 px-4 py-2.5 rounded-lg shadow-xl text-xs font-semibold flex items-center gap-2 transition-all duration-300 transform translate-y-0 opacity-100 ${colors[type] || colors.info}`;
        toast.textContent = message;

        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => {
            toast.className = "hidden";
        }, 3000);
    }

    function escapeHtml(str) {
        if (!str) return "";
        return str.toString()
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function updateUI() {
        applyFontSize(AppState.fontSize, false);
        applyTheme(AppState.theme, false);
    }

    // Export globally for inline event handlers and tests
    window.IELTSApp = {
        init,
        switchPassage,
        jumpToQuestion,
        toggleFlag,
        openSubmitModal,
        closeModal,
        submitExam,
        clearSession,
        openTutorManager,
        exportTestJSON,
        importTestJSON,
        resetToDefaultTest,
        applyFontSize,
        applyTheme,
        setMobileView,
        renderResultsDashboard,
        getState: () => AppState
    };

    // Auto-boot on DOMContentLoaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
