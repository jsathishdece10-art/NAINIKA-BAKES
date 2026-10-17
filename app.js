"use strict";

/*
 * NAINIKA BAKES BUSINESS MANAGER
 * Storage: local backup + authenticated Firebase Firestore cloud sync.
 * Existing business features and calculations are preserved.
 */

const DB_KEY = "nainika_bakes_business_v2";

const emptyDB = {
    purchases: [],
    recipes: [],
    productions: [],
    sales: [],
    wastage: []
};

function loadDB() {
    try {
        const raw = localStorage.getItem(DB_KEY);
        if (!raw) return structuredClone(emptyDB);
        const parsed = JSON.parse(raw);
        return {
            purchases: Array.isArray(parsed.purchases) ? parsed.purchases : [],
            recipes: Array.isArray(parsed.recipes) ? parsed.recipes : [],
            productions: Array.isArray(parsed.productions) ? parsed.productions : [],
            sales: Array.isArray(parsed.sales) ? parsed.sales : [],
            wastage: Array.isArray(parsed.wastage) ? parsed.wastage : []
        };
    } catch (error) {
        console.error(error);
        alert("Saved data could not be read. Please export a backup if possible.");
        return structuredClone(emptyDB);
    }
}

let db = loadDB();
let cloudReady = false;
let cloudSaveTimer = null;
let cloudLoadGeneration = 0;

function saveDB() {
    try {
        // Keep local backup so the existing app remains resilient if internet is down.
        localStorage.setItem(DB_KEY, JSON.stringify(db));
        renderAll();
        if (cloudReady && window.firebaseDb && window.firebaseAuth?.currentUser) {
            clearTimeout(cloudSaveTimer);
            cloudSaveTimer = setTimeout(async () => {
                try {
                    const user = window.firebaseAuth.currentUser;
                    if (!user) return;
                    await window.firebaseDb.collection("users").doc(user.uid)
                        .collection("appData").doc("main")
                        .set({ ...db, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
                    const status = document.getElementById("cloudStatus");
                    if (status) status.textContent = "Cloud synced ✓";
                } catch (error) {
                    console.error("Firebase save failed:", error);
                    const status = document.getElementById("cloudStatus");
                    if (status) status.textContent = "Cloud sync failed — local backup saved";
                }
            }, 400);
        }
    } catch (error) {
        console.error(error);
        alert("Data could not be saved. Export a backup and check browser storage.");
    }
}

async function loadSignedInUserData(user) {
    const generation = ++cloudLoadGeneration;
    const status = document.getElementById("cloudStatus");
    if (status) status.textContent = "Loading your cloud data…";
    cloudReady = false;
    try {
        const ref = window.firebaseDb.collection("users").doc(user.uid).collection("appData").doc("main");
        const snap = await ref.get();
        if (generation !== cloudLoadGeneration) return;
        if (snap.exists) {
            const data = snap.data() || {};
            db = {
                purchases: Array.isArray(data.purchases) ? data.purchases : [],
                recipes: Array.isArray(data.recipes) ? data.recipes : [],
                productions: Array.isArray(data.productions) ? data.productions : [],
                sales: Array.isArray(data.sales) ? data.sales : [],
                wastage: Array.isArray(data.wastage) ? data.wastage : []
            };
            localStorage.setItem(DB_KEY, JSON.stringify(db));
        } else {
            // First sign-in: migrate existing browser data to this signed-in account.
            await ref.set({ ...db, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        }
        cloudReady = true;
        renderAll();
        if (getIngredientNames().length === 0) addRecipeRow();
        if (purchaseItemsContainer.querySelectorAll(".purchase-item-row").length === 0) addPurchaseItemRow();
        updatePurchaseTotal();
        if (status) status.textContent = "Cloud synced ✓";
    } catch (error) {
        console.error("Firebase load failed:", error);
        if (status) status.textContent = "Cloud connection failed — check Firestore Rules";
        alert("Could not load Firebase data. Your browser backup was kept. Check that Firestore Rules allow only your signed-in account.");
    }
}

function initPrivateFirebaseLogin() {
    const loginPanel = document.getElementById("loginPanel");
    const appLayout = document.querySelector(".layout");
    const loginForm = document.getElementById("loginForm");
    const loginMessage = document.getElementById("loginMessage");
    const googleButton = document.getElementById("googleLogin");
    const logoutButton = document.getElementById("logoutButton");
    const setMessage = message => { if (loginMessage) loginMessage.textContent = message; };

    loginForm?.addEventListener("submit", async event => {
        event.preventDefault();
        setMessage("Signing in…");
        try {
            const email = document.getElementById("loginEmail").value.trim();
            const password = document.getElementById("loginPassword").value;
            await window.firebaseAuth.signInWithEmailAndPassword(email, password);
        } catch (error) {
            console.error(error);
            setMessage("Login failed. Check your email/password and Firebase Authentication setup.");
        }
    });
    googleButton?.addEventListener("click", async () => {
        setMessage("Opening Google sign-in…");
        try {
            await window.firebaseAuth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
        } catch (error) {
            console.error(error);
            setMessage("Google sign-in failed. Try Email/Password login.");
        }
    });
    logoutButton?.addEventListener("click", async () => {
        cloudReady = false;
        await window.firebaseAuth.signOut();
    });

    window.firebaseAuth.onAuthStateChanged(async user => {
        cloudReady = false;
        if (!user) {
            if (loginPanel) loginPanel.hidden = false;
            if (appLayout) appLayout.hidden = true;
            if (logoutButton) logoutButton.hidden = true;
            setMessage("Sign in to access your private NAINIKA BAKES data.");
            return;
        }
        if (loginPanel) loginPanel.hidden = true;
        if (appLayout) appLayout.hidden = false;
        if (logoutButton) logoutButton.hidden = false;
        const account = document.getElementById("signedInEmail");
        if (account) account.textContent = user.email || "Google account";
        await loadSignedInUserData(user);
    });
}


function id() {
    return crypto.randomUUID();
}

function todayString() {
    const date = new Date();
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 10);
}

function money(value) {
    return Number(value || 0).toLocaleString("en-IN", {
        style: "currency",
        currency: "INR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function number(value) {
    return Number(value || 0);
}

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function baseUnit(unit) {
    if (unit === "kg") return "g";
    if (unit === "L") return "ml";
    return unit;
}

function toBaseQty(qty, unit) {
    if (unit === "kg" || unit === "L") return qty * 1000;
    return qty;
}

function convertQty(qty, fromUnit, toUnit) {
    if (fromUnit === toUnit) return qty;

    const weightUnits = ["g", "kg"];
    const volumeUnits = ["ml", "L"];

    if (weightUnits.includes(fromUnit) && weightUnits.includes(toUnit)) {
        const grams = fromUnit === "kg" ? qty * 1000 : qty;
        return toUnit === "kg" ? grams / 1000 : grams;
    }

    if (volumeUnits.includes(fromUnit) && volumeUnits.includes(toUnit)) {
        const ml = fromUnit === "L" ? qty * 1000 : qty;
        return toUnit === "L" ? ml / 1000 : ml;
    }

    return fromUnit === toUnit ? qty : NaN;
}

function displayQty(qty, unit) {
    return `${Number(qty).toLocaleString("en-IN", {
        maximumFractionDigits: 3
    })} ${unit}`;
}

/* ---------------- NAVIGATION ---------------- */

const titles = {
    dashboard: "Business Dashboard",
    purchase: "Purchase Entry",
    stock: "Ingredient Stock",
    recipe: "Recipe Costing",
    production: "Production Entry",
    sales: "Sales Entry",
    reports: "Profit & Loss Reports"
};

function showPage(pageId) {
    document.querySelectorAll(".page").forEach(page => {
        page.classList.toggle("hidden", page.id !== pageId);
    });

    document.querySelectorAll(".nav").forEach(button => {
        button.classList.toggle("active", button.dataset.page === pageId);
    });

    document.getElementById("pageTitle").textContent =
        titles[pageId] || "NAINIKA BAKES";
}

document.querySelectorAll("[data-page]").forEach(button => {
    button.addEventListener("click", () => showPage(button.dataset.page));
});

document.querySelectorAll("[data-go]").forEach(button => {
    button.addEventListener("click", () => showPage(button.dataset.go));
});

document.getElementById("today").textContent =
    new Date().toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric"
    });

[
    "purchaseDate",
    "productionDate",
    "salesDate"
].forEach(field => {
    document.getElementById(field).value = todayString();
});

/* ---------------- STOCK LEDGER ---------------- */

/*
 * Purchases add stock.
 * Production consumes recipe ingredients.
 * Wastage reduces stock.
 *
 * Stock is derived from all transactions, avoiding separate manual balances.
 */

function getIngredientNames() {
    const names = new Map();

    db.purchases.forEach(p => {
        const key = p.name.toLowerCase().trim();
        if (!names.has(key)) {
            names.set(key, {
                key,
                name: p.name,
                unit: p.baseUnit
            });
        }
    });

    return [...names.values()];
}

function getStockLedger() {
    const ledger = {};

    function getItem(name, unit) {
        const key = `${name.toLowerCase().trim()}|${unit}`;

        if (!ledger[key]) {
            ledger[key] = {
                key,
                name,
                unit,
                purchasedQty: 0,
                usedQty: 0,
                wastedQty: 0,
                purchasedValue: 0,
                remainingQty: 0,
                remainingValue: 0,
                averageUnitCost: 0
            };
        }

        return ledger[key];
    }

    db.purchases.forEach(p => {
        const item = getItem(p.name, p.baseUnit);
        item.purchasedQty += p.baseQty;
        item.purchasedValue += p.amount;
    });

    db.productions.forEach(prod => {
        const recipe = db.recipes.find(r => r.id === prod.recipeId);
        if (!recipe) return;

        recipe.ingredients.forEach(ingredient => {
            const item = getItem(ingredient.name, ingredient.unit);
            item.usedQty += ingredient.qty * prod.batches;
        });
    });

    db.wastage.forEach(w => {
        const item = getItem(w.name, w.unit);
        item.wastedQty += w.qty;
    });

    Object.values(ledger).forEach(item => {
        item.averageUnitCost = item.purchasedQty > 0
            ? item.purchasedValue / item.purchasedQty
            : 0;

        item.remainingQty =
            item.purchasedQty - item.usedQty - item.wastedQty;

        item.remainingValue =
            Math.max(0, item.remainingQty) * item.averageUnitCost;
    });

    return Object.values(ledger);
}

function getIngredientStock(name, unit) {
    const item = getStockLedger().find(i =>
        i.name.toLowerCase() === name.toLowerCase() &&
        i.unit === unit
    );

    return item ? item.remainingQty : 0;
}

function getPurchaseCost(name, unit, qty) {
    const purchases = db.purchases.filter(p =>
        p.name.toLowerCase() === name.toLowerCase() &&
        p.baseUnit === unit
    );

    const totalQty = purchases.reduce((sum, p) => sum + p.baseQty, 0);
    const totalAmount = purchases.reduce((sum, p) => sum + p.amount, 0);

    if (totalQty <= 0) return 0;

    return (totalAmount / totalQty) * qty;
}

function getPurchaseUnitCost(name, unit) {
    const purchases = db.purchases.filter(p =>
        p.name.toLowerCase() === name.toLowerCase() &&
        p.baseUnit === unit
    );

    const totalQty = purchases.reduce((sum, p) => sum + p.baseQty, 0);
    const totalAmount = purchases.reduce((sum, p) => sum + p.amount, 0);

    return totalQty > 0 ? totalAmount / totalQty : 0;
}

/* ---------------- PURCHASE ENTRY ---------------- */

// Rebuild the purchase form so the app works with the older index.html too.
const purchaseForm = document.getElementById("purchaseForm");
const previousPurchaseDate = document.getElementById("purchaseDate")?.value || todayString();
purchaseForm.innerHTML = `
    <div class="purchase-bill-fields">
        <label>Date
            <input type="date" id="purchaseDate" required style="display:block;width:100%;box-sizing:border-box;margin-top:6px;">
        </label>
        <label>Supplier
            <input type="text" id="supplier" placeholder="Supplier name" style="display:block;width:100%;box-sizing:border-box;margin-top:6px;">
        </label>
        <label>Bill Number (optional)
            <input type="text" id="billNumber" placeholder="Bill number" style="display:block;width:100%;box-sizing:border-box;margin-top:6px;">
        </label>
    </div>
    <div style="overflow-x:auto;">
        <div style="display:grid;grid-template-columns:minmax(150px,2fr) minmax(100px,1fr) minmax(100px,1fr) minmax(120px,1fr) minmax(140px,1.3fr);gap:8px;min-width:720px;font-weight:700;margin-bottom:8px;">
            <span>Ingredient / Item</span><span>Purchased Qty</span><span>Unit</span><span>Total Amount (₹)</span><span>Action</span>
        </div>
        <div id="purchaseItems" style="min-width:720px;"></div>
    </div>
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:12px;">
        <button type="button" id="addPurchaseItem">+ Add Item</button>
        <strong>Total Bill Amount: ₹ <span id="purchaseGrandTotal">0.00</span></strong>
    </div>
    <button type="submit" style="margin-top:14px;">Save Purchase Bill</button>
    <p><small>Unit cost is calculated automatically from quantity and total amount. Date will stay selected until you change it.</small></p>
`;
const purchaseDateInput = document.getElementById("purchaseDate");
purchaseDateInput.value = previousPurchaseDate;
const purchaseItemsContainer = document.getElementById("purchaseItems");
const addPurchaseItemButton = document.getElementById("addPurchaseItem");
const purchaseGrandTotal = document.getElementById("purchaseGrandTotal");
let editingPurchaseId = null;

function updatePurchaseTotal() {
    let total = 0;
    purchaseItemsContainer.querySelectorAll(".item-amount").forEach(input => {
        total += Number(input.value) || 0;
    });
    purchaseGrandTotal.textContent = total.toFixed(2);
}

function addPurchaseItemRow(initial = {}) {
    const row = document.createElement("div");
    row.className = "purchase-item-row";
    row.style.cssText = "display:grid;grid-template-columns:minmax(150px,2fr) minmax(100px,1fr) minmax(100px,1fr) minmax(120px,1fr) minmax(140px,1.3fr);gap:8px;margin-bottom:8px;align-items:center;min-width:720px;";
    row.innerHTML = `
        <input type="text" class="item-name" placeholder="Ingredient / Item" required>
        <input type="number" class="item-qty" min="0.001" step="any" placeholder="Quantity" required>
        <select class="item-unit" required>
            <option value="g">Grams (g)</option><option value="kg">Kg</option>
            <option value="ml">ML</option><option value="L">Litres</option>
            <option value="Pieces">Pieces</option><option value="Packets">Packets</option>
        </select>
        <input type="number" class="item-amount" min="0.01" step="0.01" placeholder="Amount (₹)" required>
        <button type="button" class="remove-purchase-item">Remove</button>
    `;
    row.querySelector(".item-name").value = initial.name || "";
    row.querySelector(".item-qty").value = initial.qty ?? "";
    row.querySelector(".item-unit").value = initial.unit || "g";
    row.querySelector(".item-amount").value = initial.amount ?? "";
    purchaseItemsContainer.appendChild(row);
}

function removePurchaseItem(button) {
    const rows = purchaseItemsContainer.querySelectorAll(".purchase-item-row");
    if (rows.length <= 1) {
        alert("At least one purchase item is required.");
        return;
    }
    button.closest(".purchase-item-row").remove();
    updatePurchaseTotal();
}

addPurchaseItemButton.addEventListener("click", () => addPurchaseItemRow());
purchaseItemsContainer.addEventListener("click", event => {
    if (event.target.classList.contains("remove-purchase-item")) removePurchaseItem(event.target);
});
purchaseItemsContainer.addEventListener("input", event => {
    if (event.target.classList.contains("item-amount")) updatePurchaseTotal();
});
purchaseItemsContainer.addEventListener("change", event => {
    if (event.target.classList.contains("item-amount")) updatePurchaseTotal();
});

purchaseForm.addEventListener("submit", function (event) {
    event.preventDefault();
    const date = purchaseDateInput.value;
    const supplier = document.getElementById("supplier").value.trim();
    const billNo = document.getElementById("billNumber").value.trim();
    const rows = [...purchaseItemsContainer.querySelectorAll(".purchase-item-row")];
    if (!date || rows.length === 0) {
        alert("Purchase date and at least one item enter pannunga.");
        return;
    }
    const items = [];
    for (const row of rows) {
        const name = row.querySelector(".item-name").value.trim();
        const qty = Number(row.querySelector(".item-qty").value);
        const unit = row.querySelector(".item-unit").value;
        const amount = Number(row.querySelector(".item-amount").value);
        if (!name || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(amount) || amount <= 0) {
            alert("Ella item-kum name, valid quantity, amount enter pannunga.");
            return;
        }
        items.push({ name, qty, unit, baseQty: toBaseQty(qty, unit), baseUnit: baseUnit(unit), amount });
    }

    const wasEditingPurchase = Boolean(editingPurchaseId);
    if (editingPurchaseId) {
        // Edit mode changes the selected historical item only; it preserves its ID.
        if (items.length !== 1) {
            alert("History edit-la one item mattum edit pannunga. New bill-la multiple items add pannalaam.");
            return;
        }
        const item = items[0];
        const index = db.purchases.findIndex(p => p.id === editingPurchaseId);
        if (index < 0) {
            alert("Purchase record not found. Please refresh and try again.");
            return;
        }
        db.purchases[index] = { ...db.purchases[index], ...item, date, supplier, billNo };
        editingPurchaseId = null;
        const submitButton = purchaseForm.querySelector('button[type="submit"]');
        submitButton.textContent = "Save Purchase Bill";
    } else {
        items.forEach(item => db.purchases.push({ id: id(), date, ...item, supplier, billNo }));
    }

    saveDB();
    alert(wasEditingPurchase ? "Purchase updated successfully." : "Purchase bill saved successfully!");
    // Keep the selected date as requested; clear only item fields for the next bill.
    document.getElementById("supplier").value = "";
    document.getElementById("billNumber").value = "";
    purchaseItemsContainer.innerHTML = "";
    addPurchaseItemRow();
    updatePurchaseTotal();
});

function editPurchaseRecord(purchaseId) {
    const p = db.purchases.find(item => item.id === purchaseId);
    if (!p) return;
    editingPurchaseId = p.id;
    purchaseDateInput.value = p.date || todayString();
    document.getElementById("supplier").value = p.supplier || "";
    document.getElementById("billNumber").value = p.billNo || "";
    purchaseItemsContainer.innerHTML = "";
    addPurchaseItemRow(p);
    updatePurchaseTotal();
    purchaseForm.querySelector('button[type="submit"]').textContent = "Update Purchase";
    purchaseForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------------- RECIPE COSTING ---------------- */

const recipeRows = document.getElementById("recipeRows");

function addRecipeRow(initial = {}) {
    const row = document.createElement("div");
    row.className = "ingredient-row";

    const options = getIngredientNames().map(item => `
        <option value="${escapeHTML(item.key)}"
                data-name="${escapeHTML(item.name)}"
                data-unit="${escapeHTML(item.unit)}">
            ${escapeHTML(item.name)} (${escapeHTML(item.unit)})
        </option>
    `).join("");

    row.innerHTML = `
        <select class="recipe-ingredient" required>
            <option value="">Select ingredient</option>
            ${options}
        </select>

        <input type="number" class="recipe-qty"
               min="0.001" step="any"
               placeholder="Used quantity" required>

        <div class="recipe-cost">Cost: ₹0.00</div>

        <button type="button" class="remove-row">Remove</button>
    `;

    recipeRows.appendChild(row);

    const select = row.querySelector(".recipe-ingredient");
    const qtyInput = row.querySelector(".recipe-qty");
    const costOutput = row.querySelector(".recipe-cost");
    console.log("Ingredient dropdown options:", select.options.length);

    if (initial.name) {
        select.value = initial.name.toLowerCase();
        qtyInput.value = initial.qty;
    }

    function updateRowCost() {
        const option = select.selectedOptions[0];

        if (!option || !option.dataset.name) {
            costOutput.textContent = "Cost: ₹0.00";
            return;
        }

        const name = option.dataset.name;
        const unit = option.dataset.unit;
        const qty = number(qtyInput.value);
        const unitCost = getPurchaseUnitCost(name, unit);

        costOutput.textContent =
            `Cost: ${money(unitCost * qty)} / ${unit}`;
    }

    select.addEventListener("change", updateRowCost);
    qtyInput.addEventListener("input", updateRowCost);

    row.querySelector(".remove-row").addEventListener("click", () => {
        row.remove();
    });

    updateRowCost();
}

document.getElementById("addRecipeRow").addEventListener("click", () => {
    if (getIngredientNames().length === 0) {
        alert("First add ingredients in Purchase Entry.");
        return;
    }

    addRecipeRow();
});

function collectRecipeIngredients() {
    const rows = [...recipeRows.querySelectorAll(".ingredient-row")];
    const ingredients = [];

    for (const row of rows) {
        const select = row.querySelector(".recipe-ingredient");
        const option = select.selectedOptions[0];
        const qty = number(row.querySelector(".recipe-qty").value);

        if (!option || !option.dataset.name || qty <= 0) {
            throw new Error("Select each ingredient and enter a valid quantity.");
        }

        const name = option.dataset.name;
        const unit = option.dataset.unit;

        ingredients.push({
            name,
            unit,
            qty,
            cost: getPurchaseCost(name, unit, qty)
        });
    }

    if (ingredients.length === 0) {
        throw new Error("Add at least one ingredient.");
    }

    return ingredients;
}

document.getElementById("recipeForm").addEventListener("submit", event => {
    event.preventDefault();

    try {
        const name = document.getElementById("recipeName").value.trim();
        const finishedWeight = number(
            document.getElementById("recipeWeight").value
        );
        const sellingPrice = number(
            document.getElementById("recipePrice").value
        );

        if (!name || finishedWeight <= 0 || sellingPrice < 0) {
            throw new Error("Enter valid recipe details.");
        }

        const ingredients = collectRecipeIngredients();
        const ingredientCost = ingredients.reduce((sum, item) => sum + item.cost, 0);

        const existing = db.recipes.find(r =>
            r.name.toLowerCase() === name.toLowerCase()
        );

        const recipe = {
            id: existing ? existing.id : id(),
            name,
            finishedWeight,
            sellingPrice,
            ingredients,
            ingredientCost,
            costPerGram: ingredientCost / finishedWeight,
            updatedAt: new Date().toISOString()
        };

        if (existing) {
            db.recipes = db.recipes.map(r => r.id === existing.id ? recipe : r);
        } else {
            db.recipes.push(recipe);
        }

        saveDB();
        updateRecipeResult(recipe);
        event.target.reset();
        recipeRows.innerHTML = "";

        alert("Recipe saved. Cost is based on current weighted-average purchase prices.");
    } catch (error) {
        alert(error.message);
    }
});

function updateRecipeResult(recipe) {
    const result = document.getElementById("recipeResult");

    result.innerHTML = `
        <h3>${escapeHTML(recipe.name)}</h3>
        <p>Total ingredient cost per batch: <strong>${money(recipe.ingredientCost)}</strong></p>
        <p>Actual finished batch weight: ${recipe.finishedWeight} g</p>
        <p>Ingredient cost per gram: ${money(recipe.costPerGram)}</p>
        <p>Estimated ingredient cost for 150 g: ${money(recipe.costPerGram * 150)}</p>
        <p>Estimated ingredient cost for 200 g: ${money(recipe.costPerGram * 200)}</p>
        <p>Estimated ingredient cost for 250 g: ${money(recipe.costPerGram * 250)}</p>
        <p>Estimated ingredient cost for 500 g: ${money(recipe.costPerGram * 500)}</p>
        <p>Default selling price per box: ${money(recipe.sellingPrice)}</p>
        <p class="${recipe.sellingPrice >= recipe.ingredientCost ? "good" : "bad"}">
            Selling price minus one batch's ingredient cost:
            ${money(recipe.sellingPrice - recipe.ingredientCost)}
        </p>
        <small>
            These per-gram estimates assume that the recipe's cost is proportional
            to finished weight. Packaging, toppings and other costs are excluded.
        </small>
    `;
}

/* ---------------- PRODUCTION ---------------- */

document.getElementById("productionForm").addEventListener("submit", event => {
    event.preventDefault();

    const recipeId = document.getElementById("productionRecipe").value;
    const recipe = db.recipes.find(r => r.id === recipeId);

    if (!recipe) {
        alert("Save a recipe first.");
        return;
    }

    const batches = number(document.getElementById("productionBatches").value);
    const actualWeight = number(document.getElementById("actualProductionWeight").value);
    const wastage = number(document.getElementById("productionWastage").value);

    if (batches <= 0 || actualWeight <= 0 || wastage < 0) {
        alert("Enter valid production details.");
        return;
    }

    for (const ingredient of recipe.ingredients) {
        const needed = ingredient.qty * batches;
        const available = getIngredientStock(ingredient.name, ingredient.unit);

        if (available < needed) {
            alert(
                `Insufficient stock for ${ingredient.name}. ` +
                `Available: ${displayQty(available, ingredient.unit)}, ` +
                `required: ${displayQty(needed, ingredient.unit)}.`
            );
            return;
        }
    }

    const record = {
        id: id(),
        date: document.getElementById("productionDate").value,
        recipeId,
        recipeName: recipe.name,
        batches,
        actualWeight,
        wastage,
        saleableWeight: Math.max(0, actualWeight - wastage),
        ingredientCost: recipe.ingredientCost * batches
    };

    db.productions.push(record);
    saveDB();

    document.getElementById("productionResult").innerHTML = `
        <p><strong>Production saved:</strong> ${escapeHTML(recipe.name)}</p>
        <p>Actual finished weight: ${actualWeight} g</p>
        <p>Saleable weight after wastage: ${record.saleableWeight} g</p>
        <p>Ingredient cost: ${money(record.ingredientCost)}</p>
    `;

    event.target.reset();
    document.getElementById("productionDate").value = todayString();
    document.getElementById("productionBatches").value = "1";
    document.getElementById("productionWastage").value = "0";

    alert("Production saved and ingredient stock deducted.");
});

/* ---------------- WASTAGE ---------------- */

document.getElementById("wasteForm").addEventListener("submit", event => {
    event.preventDefault();

    const selected = document.getElementById("wasteIngredient").selectedOptions[0];
    if (!selected || !selected.dataset.name) {
        alert("Select an ingredient.");
        return;
    }

    const name = selected.dataset.name;
    const unit = selected.dataset.unit;
    const qty = number(document.getElementById("wasteQty").value);

    if (qty <= 0) {
        alert("Enter a valid wastage quantity.");
        return;
    }

    const available = getIngredientStock(name, unit);

    if (qty > available) {
        alert(`Only ${displayQty(available, unit)} is available.`);
        return;
    }

    db.wastage.push({
        id: id(),
        date: todayString(),
        name,
        unit,
        qty,
        reason: document.getElementById("wasteReason").value.trim()
    });

    saveDB();
    event.target.reset();
    alert("Wastage recorded.");
});

/* ---------------- SALES ---------------- */

document.getElementById("salesForm").addEventListener("submit", event => {
    event.preventDefault();

    const recipeId = document.getElementById("salesProduct").value;
    const recipe = db.recipes.find(r => r.id === recipeId);

    if (!recipe) {
        alert("Save a recipe first.");
        return;
    }

    const weight = number(document.getElementById("salesWeight").value);
    const qty = number(document.getElementById("salesQty").value);
    const price = number(document.getElementById("salesPrice").value);
    const packaging = number(document.getElementById("packagingCost").value);
    const extra = number(document.getElementById("extraCost").value);

    if (weight <= 0 || qty <= 0 || price < 0 || packaging < 0 || extra < 0) {
        alert("Enter valid sales details.");
        return;
    }

    const availableFinishedWeight = db.productions.reduce((sum, p) =>
        sum + (p.recipeId === recipeId ? p.saleableWeight : 0), 0
    ) - db.sales.reduce((sum, s) =>
        sum + (s.recipeId === recipeId ? s.weight * s.qty : 0), 0
    );

    const requestedWeight = weight * qty;

    if (requestedWeight > availableFinishedWeight) {
        alert(
            `Insufficient finished stock. Available: ${availableFinishedWeight} g. ` +
            `Required: ${requestedWeight} g.`
        );
        return;
    }

    const revenue = price * qty;
    const ingredientCost = recipe.costPerGram * requestedWeight;
    const totalPackaging = packaging * qty;
    const totalExtra = extra * qty;
    const totalCost = ingredientCost + totalPackaging + totalExtra;

    db.sales.push({
        id: id(),
        date: document.getElementById("salesDate").value,
        recipeId,
        product: recipe.name,
        weight,
        qty,
        price,
        packaging,
        extra,
        customer: document.getElementById("customerName").value.trim(),
        revenue,
        ingredientCost,
        totalCost,
        profit: revenue - totalCost
    });

    saveDB();

    document.getElementById("salesPreview").innerHTML = `
        <p>Sales revenue: ${money(revenue)}</p>
        <p>Ingredient cost: ${money(ingredientCost)}</p>
        <p>Packaging: ${money(totalPackaging)}</p>
        <p>Other costs: ${money(totalExtra)}</p>
        <p><strong>Estimated profit: ${money(revenue - totalCost)}</strong></p>
    `;

    event.target.reset();
    document.getElementById("salesDate").value = todayString();
    document.getElementById("salesWeight").value = "200";
    document.getElementById("packagingCost").value = "0";
    document.getElementById("extraCost").value = "0";

    alert("Sale saved.");
});

/* ---------------- DASHBOARD AND TABLES ---------------- */

function table(headers, rows) {
    if (rows.length === 0) return "<p>No records available.</p>";

    return `
        <div class="table-wrap">
            <table>
                <thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>
                <tbody>
                    ${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("")}
                </tbody>
            </table>
        </div>
    `;
}

function renderPurchases() {
    const rows = [...db.purchases].reverse().map(p => [
        escapeHTML(p.date),
        escapeHTML(p.name),
        displayQty(p.qty, p.unit),
        escapeHTML(p.unit),
        money(p.amount),
        escapeHTML(p.supplier || "—"),
        `<button type="button" data-edit-purchase="${p.id}">Edit</button>
         <button type="button" data-delete-purchase="${p.id}">Delete</button>`
    ]);

    document.getElementById("purchaseHistory").innerHTML = table(
        ["Date", "Ingredient / Item", "Purchased Qty", "Unit", "Total Amount", "Supplier", "Action"],
        rows
    );

    document.querySelectorAll("[data-edit-purchase]").forEach(button => {
        button.addEventListener("click", () => editPurchaseRecord(button.dataset.editPurchase));
    });

    document.querySelectorAll("[data-delete-purchase]").forEach(button => {
        button.addEventListener("click", () => {
            const purchaseId = button.dataset.deletePurchase;
           
            if (confirm("Delete this purchase record? Stock and costing totals will change.")) {
                db.purchases = db.purchases.filter(p => p.id !== purchaseId);
                saveDB();
            }
        });
    });
}

function renderStock() {
    const stock = getStockLedger();

    document.getElementById("stockTable").innerHTML = table(
    [
        "Ingredient",
        "Purchased",
        "Used",
        "Wastage",
        "Balance",
        "Unit",
        "Balance Value",
        "Action"
    ],
    stock.map(item => [
        escapeHTML(item.name),
        item.purchasedQty.toFixed(3),
        item.usedQty.toFixed(3),
        item.wastedQty.toFixed(3),
        `<strong class="${item.remainingQty < 0 ? "bad" : "good"}">${item.remainingQty.toFixed(3)}</strong>`,
        escapeHTML(item.unit),
        money(item.remainingValue),
        `<button type="button" data-delete-ingredient="${escapeHTML(item.key)}">Delete</button>`
    ])
);

document.querySelectorAll("[data-delete-ingredient]").forEach(button => {
    button.addEventListener("click", () => {
        const ingredientKey = button.dataset.deleteIngredient;

        const item = getStockLedger().find(i => i.key === ingredientKey);
        if (!item) return;

        if (item.usedQty > 0 || item.wastedQty > 0) {
            alert("This ingredient has production or wastage records. Delete is blocked to protect stock calculations.");
            return;
        }

        const relatedPurchases = db.purchases.filter(p =>
            `${p.name.toLowerCase().trim()}|${p.baseUnit}` === ingredientKey
        );

        if (!confirm(
            `Delete ${item.name} and its ${relatedPurchases.length} purchase record(s)?`
        )) return;

        db.purchases = db.purchases.filter(p =>
            `${p.name.toLowerCase().trim()}|${p.baseUnit}` !== ingredientKey
        );

        saveDB();
        alert("Ingredient deleted successfully.");
    });
});

    const select = document.getElementById("wasteIngredient");

    select.innerHTML = stock.map(item => `
        <option value="${escapeHTML(item.key)}"
                data-name="${escapeHTML(item.name)}"
                data-unit="${escapeHTML(item.unit)}">
            ${escapeHTML(item.name)} (${escapeHTML(item.unit)})
        </option>
    `).join("");
}

function renderRecipes() {
    document.getElementById("recipeList").innerHTML = table(
        [
            "Recipe",
            "Batch Weight",
            "Ingredient Cost",
            "Cost per g",
            "Default Price",
            "Action"
        ],
        db.recipes.map(r => [
            escapeHTML(r.name),
            `${r.finishedWeight} g`,
            money(r.ingredientCost),
            money(r.costPerGram),
            money(r.sellingPrice),
            `<button type="button" data-delete-recipe="${r.id}">Delete</button>`
        ])
    );

    const options = db.recipes.map(r =>
        `<option value="${r.id}">${escapeHTML(r.name)}</option>`
    ).join("");

    document.getElementById("productionRecipe").innerHTML = options;
    document.getElementById("salesProduct").innerHTML = options;

    const selectedRecipe = db.recipes[0];

    if (selectedRecipe) {
        document.getElementById("recipePrice").value =
            selectedRecipe.sellingPrice;

        document.getElementById("salesPrice").value =
            selectedRecipe.sellingPrice;
    }

    document.querySelectorAll("[data-delete-recipe]").forEach(button => {
        button.addEventListener("click", () => {
            const recipeId = button.dataset.deleteRecipe;

            const usedInProduction = db.productions.some(
                p => p.recipeId === recipeId
            );

            const usedInSales = db.sales.some(
                s => s.recipeId === recipeId
            );

            if (usedInProduction || usedInSales) {
                alert(
                    "This recipe has production or sales records. " +
                    "Delete those records first before deleting this recipe."
                );
                return;
            }

            if (confirm("Are you sure you want to delete this recipe?")) {
                db.recipes = db.recipes.filter(
                    r => r.id !== recipeId
                );

                saveDB();
                alert("Recipe deleted successfully.");
            }
        });
    });
}

function renderProduction() {
    document.getElementById("productionHistory").innerHTML = table(
        [
            "Date",
            "Recipe",
            "Batches",
            "Finished Weight",
            "Saleable Weight",
            "Ingredient Cost",
            "Action"
        ],
        [...db.productions].reverse().map(p => [
            escapeHTML(p.date),
            escapeHTML(p.recipeName),
            p.batches,
            `${p.actualWeight} g`,
            `${p.saleableWeight} g`,
            money(p.ingredientCost),
            `<button type="button" data-delete-production="${p.id}">Delete</button>`
        ])
    );

    document.querySelectorAll("[data-delete-production]").forEach(button => {
        button.addEventListener("click", () => {
            const productionId = button.dataset.deleteProduction;
            const production = db.productions.find(p => p.id === productionId);

            if (!production) {
                alert("Production record not found.");
                return;
            }

            const confirmed = confirm(
                `Delete ${production.recipeName} production (${production.actualWeight} g)?`
            );

            if (!confirmed) return;

            const hasSales = db.sales.some(s =>
                s.recipeId === production.recipeId
            );

            if (hasSales) {
                alert(
                    "This recipe has sales records. Delete is blocked to protect stock calculations."
                );
                return;
            }

            db.productions = db.productions.filter(
                p => p.id !== productionId
            );

            saveDB();
            alert("Production record deleted.");
        });
    });
}

function renderSales() {
    document.getElementById("salesHistory").innerHTML = table(
        ["Date", "Product", "Weight", "Qty", "Revenue", "Cost", "Profit", "Action"],
        [...db.sales].reverse().map(s => [
            escapeHTML(s.date),
            escapeHTML(s.product),
            `${s.weight} g`,
            s.qty,
            money(s.revenue),
            money(s.totalCost),
            `<strong class="${s.profit >= 0 ? "good" : "bad"}">${money(s.profit)}</strong>`,
            `<button type="button" data-delete-sale="${s.id}">Delete</button>`
        ])
    );

    document.querySelectorAll("[data-delete-sale]").forEach(button => {
        button.addEventListener("click", () => {
            const saleId = button.dataset.deleteSale;
            const sale = db.sales.find(s => s.id === saleId);

            if (!sale) {
                alert("Sale record not found.");
                return;
            }

            if (!confirm(
                `Delete ${sale.product} sale (${sale.weight} g x ${sale.qty})?`
            )) {
                return;
            }

            db.sales = db.sales.filter(s => s.id !== saleId);

            saveDB();
            alert("Sale record deleted. Finished stock has been recalculated.");
        });
    });
}

function renderDashboard() {
    const purchaseTotal = db.purchases.reduce((sum, p) => sum + p.amount, 0);
    const salesTotal = db.sales.reduce((sum, s) => sum + s.revenue, 0);
    const salesProfit = db.sales.reduce((sum, s) => sum + s.profit, 0);

    const stockValue = getStockLedger().reduce((sum, item) =>
        sum + item.remainingValue, 0
    );

    document.getElementById("dashPurchase").textContent = money(purchaseTotal);
    document.getElementById("dashSales").textContent = money(salesTotal);
    document.getElementById("dashStock").textContent = money(stockValue);
    document.getElementById("dashProfit").textContent = money(salesProfit);

    const lowItems = getStockLedger().filter(item =>
        item.remainingQty <= 0
    );

    document.getElementById("lowStock").innerHTML = lowItems.length
        ? lowItems.map(item =>
            `<p class="bad">${escapeHTML(item.name)}: ${item.remainingQty.toFixed(3)} ${escapeHTML(item.unit)}</p>`
          ).join("")
        : "<p>No ingredients currently at zero or below stock.</p>";

    document.getElementById("recentSales").innerHTML = table(
        ["Date", "Product", "Revenue", "Profit"],
        [...db.sales].slice(-5).reverse().map(s => [
            escapeHTML(s.date),
            escapeHTML(s.product),
            money(s.revenue),
            money(s.profit)
        ])
    );
}

function renderReports() {
    const revenue = db.sales.reduce((sum, s) => sum + s.revenue, 0);
    const productCosts = db.sales.reduce((sum, s) => sum + s.totalCost, 0);
    const profit = revenue - productCosts;

    const purchases = db.purchases.reduce((sum, p) => sum + p.amount, 0);
    const stockValue = getStockLedger().reduce((sum, item) => sum + item.remainingValue, 0);

    document.getElementById("profitReport").innerHTML = `
        <p>Total Purchases (cash spent): <strong>${money(purchases)}</strong></p>
        <p>Total Sales Revenue: <strong>${money(revenue)}</strong></p>
        <p>Estimated Cost of Products Sold: <strong>${money(productCosts)}</strong></p>
        <p>Current Ingredient Stock Value: <strong>${money(stockValue)}</strong></p>
        <p>Estimated Profit on Recorded Sales: <strong class="${profit >= 0 ? "good" : "bad"}">${money(profit)}</strong></p>
        <small>
            Profit is calculated from recipe ingredient cost plus the packaging and extra
            costs entered on each sale. Unentered overheads and taxes are excluded.
            Purchase spending is not subtracted a second time from sales profit because
            remaining ingredients are still stock.
        </small>
    `;
}

function renderAll() {
    renderPurchases();
    renderStock();
    renderRecipes();
    renderProduction();
    renderSales();
    renderDashboard();
    renderReports();
}

/* ---------------- EXPORT BACKUP ---------------- */

document.getElementById("exportBackup").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], {
        type: "application/json"
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nainika-bakes-backup-${todayString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
});

document.getElementById("exportSalesCSV").addEventListener("click", () => {
    const headers = [
        "Date", "Product", "Weight_g", "Quantity",
        "Revenue", "TotalCost", "Profit", "Customer"
    ];

    const lines = [
        headers.join(","),
        ...db.sales.map(s => [
            s.date,
            `"${s.product.replace(/"/g, '""')}"`,
            s.weight,
            s.qty,
            s.revenue,
            s.totalCost,
            s.profit,
            `"${(s.customer || "").replace(/"/g, '""')}"`
        ].join(","))
    ];

    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
        type: "text/csv;charset=utf-8;"
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nainika-bakes-sales-${todayString()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
});

/* ---------------- INITIALIZE ---------------- */

// Firebase login controls when the business app and cloud data become available.
initPrivateFirebaseLogin();
