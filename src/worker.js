// Cloudflare Worker: auth + tenant dashboard routing + signup/onboarding flow.
// Falls back to static assets (the marketing site) for everything else.

const SESSION_COOKIE = 'session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const NO_STORE = 'private, no-store, no-cache, must-revalidate';
const VERIFICATION_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const RESET_TTL_SECONDS = 60 * 60; // 1 hour
const NOTIFY_EMAIL = 'hndrx@claims-collection.net';
const SUPPORT_EMAIL = 'help@claims-collection.net';
const FROM_EMAIL = 'clAIms <info@claims-collection.net>';
const SITE_URL = 'https://claims-collection.net';

const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com','yahoo.com','outlook.com','hotmail.com','icloud.com','aol.com',
  'protonmail.com','live.com','msn.com','me.com','mail.com','gmx.com'
]);

const STRIPE_LINKS = {
  starter: 'https://buy.stripe.com/3cI9AM8I3a1j5Rnf5Zb7y00',
  growth: 'https://buy.stripe.com/dRm5kw2jF8Xf6Vr0b5b7y01',
  enterprise: null
};

const HELP_WIDGET_HTML = '<style>' +
  '#clms-help-btn{position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;background:#C29B57;color:#171717;border:none;box-shadow:0 10px 30px -8px rgba(23,23,23,0.45);cursor:pointer;font-family:"IBM Plex Sans",Arial,sans-serif;font-weight:700;font-size:22px;z-index:99999;display:flex;align-items:center;justify-content:center;transition:transform .15s ease, box-shadow .15s ease;line-height:1;}' +
  '#clms-help-btn:hover{transform:scale(1.06);box-shadow:0 14px 36px -8px rgba(23,23,23,0.55);}' +
  '#clms-help-panel{position:fixed;bottom:92px;right:24px;width:320px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #E5E0D2;border-radius:14px;box-shadow:0 24px 60px -20px rgba(23,23,23,0.35);z-index:99999;display:none;overflow:hidden;font-family:"IBM Plex Sans",Arial,sans-serif;}' +
  '#clms-help-panel.open{display:block;}' +
  '#clms-help-panel .chp-head{background:#171717;color:#fff;padding:14px 16px;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;}' +
  '#clms-help-panel .chp-head h4{margin:0;font-size:14px;font-weight:600;}' +
  '#clms-help-panel .chp-head span{display:block;font-size:10.5px;color:#DCC393;margin-top:3px;}' +
  '#clms-help-panel .chp-close{background:none;border:none;color:#D8D4C8;font-size:18px;cursor:pointer;line-height:1;padding:0;}' +
  '#clms-help-panel .chp-close:hover{color:#fff;}' +
  '#clms-help-panel .chp-body{padding:16px;}' +
  '#clms-help-panel input,#clms-help-panel textarea{width:100%;font-family:inherit;font-size:13px;color:#171717;border:1.5px solid #E5E0D2;border-radius:8px;padding:9px 11px;background:#FBFAF6;margin-bottom:10px;box-sizing:border-box;}' +
  '#clms-help-panel textarea{min-height:70px;resize:vertical;}' +
  '#clms-help-panel input:focus,#clms-help-panel textarea:focus{outline:none;border-color:#C29B57;}' +
  '#clms-help-panel button.chp-submit{width:100%;background:#171717;color:#fff;font-weight:600;font-size:13px;padding:10px;border:none;border-radius:8px;cursor:pointer;}' +
  '#clms-help-panel button.chp-submit:hover{opacity:.87;}' +
  '#clms-help-panel button.chp-submit:disabled{opacity:.6;cursor:default;}' +
  '#clms-help-panel .chp-note{font-size:11.5px;color:#615D53;margin-top:10px;line-height:1.5;}' +
  '#clms-help-panel .chp-status{display:none;padding:12px 15px;font-size:12.5px;border-radius:8px;margin-top:4px;line-height:1.5;}' +
  '#clms-help-panel .chp-status.ok{display:block;background:#DFEEE9;color:#1E5245;}' +
  '#clms-help-panel .chp-status.err{display:block;background:#F7E2DF;color:#6E3B3B;}' +
  '@media (max-width:420px){#clms-help-btn{bottom:16px;right:16px;}#clms-help-panel{right:16px;bottom:80px;}}' +
  '</style>' +
  '<button id="clms-help-btn" aria-label="Customer support and help" onclick="(function(){var p=document.getElementById(\'clms-help-panel\');p.classList.toggle(\'open\');})()">?</button>' +
  '<div id="clms-help-panel">' +
  '<div class="chp-head"><div><h4>Need help?</h4><span>We usually reply within one business day</span></div>' +
  '<button class="chp-close" aria-label="Close" onclick="document.getElementById(\'clms-help-panel\').classList.remove(\'open\')">&times;</button></div>' +
  '<div class="chp-body">' +
  '<form id="clms-help-form" onsubmit="return clmsSubmitHelp(event)">' +
  '<input type="text" id="chp-name" placeholder="Your name" autocomplete="name" required>' +
  '<input type="email" id="chp-email" placeholder="Your email" autocomplete="email" required>' +
  '<textarea id="chp-message" placeholder="How can we help?" required></textarea>' +
  '<button type="submit" class="chp-submit" id="chp-submit-btn">Send message</button>' +
  '</form>' +
  '<div class="chp-status" id="chp-status"></div>' +
  '<div class="chp-note">Or email us directly at <a href="mailto:help@claims-collection.net" style="color:#C29B57;font-weight:600;">help@claims-collection.net</a></div>' +
  '</div></div>' +
  '<script>' +
  'function clmsSubmitHelp(e){' +
  'e.preventDefault();' +
  'var btn=document.getElementById("chp-submit-btn");' +
  'var status=document.getElementById("chp-status");' +
  'status.className="chp-status";status.textContent="";' +
  'var name=document.getElementById("chp-name").value.trim();' +
  'var email=document.getElementById("chp-email").value.trim();' +
  'var message=document.getElementById("chp-message").value.trim();' +
  'if(!name||!email||!message){return false;}' +
  'btn.disabled=true;btn.textContent="Sending...";' +
  'fetch("/api/support",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name,email:email,message:message,page:location.href})})' +
  '.then(function(r){return r.json().then(function(d){return {ok:r.ok,data:d};});})' +
  '.then(function(res){' +
  'btn.disabled=false;btn.textContent="Send message";' +
  'if(res.ok&&res.data&&res.data.ok){' +
  'status.className="chp-status ok";' +
  'status.textContent="Thanks, "+name.split(" ")[0]+" — we got your message and will reply to "+email+" soon.";' +
  'document.getElementById("clms-help-form").reset();' +
  '}else{' +
  'status.className="chp-status err";' +
  'status.textContent=(res.data&&res.data.error)||"Something went wrong sending your message. Please email help@claims-collection.net directly.";' +
  '}' +
  '})' +
  '.catch(function(){' +
  'btn.disabled=false;btn.textContent="Send message";' +
  'status.className="chp-status err";' +
  'status.textContent="Network error — please email help@claims-collection.net directly.";' +
  '});' +
  'return false;' +
  '}' +
  '<' + '/script>';

const RESET_PASSWORD_SCRIPT = '<script>' +
  '(function(){' +
  'function ready(fn){if(document.readyState!=="loading"){fn();}else{document.addEventListener("DOMContentLoaded",fn);}}' +
  'ready(function(){' +
  'var resetView=document.getElementById("resetView");' +
  'var authCard=resetView?resetView.parentElement:null;' +
  'if(!resetView||!authCard){return;}' +
  'var resetNote=document.getElementById("resetNote");' +
  'if(resetNote){resetNote.innerHTML="";resetNote.classList.remove("show");}' +
  'var confirmView=document.createElement("div");' +
  'confirmView.id="clmsResetConfirmView";' +
  'confirmView.style.display="none";' +
  'confirmView.innerHTML=' +
  '\'<div class="auth-eyebrow">Reset Password</div>\'+' +
  '\'<h1>Choose a new password</h1>\'+' +
  '\'<p class="auth-sub">Enter a new password for your account.</p>\'+' +
  '\'<div class="auth-field"><label>New Password</label><input type="password" id="clms-rc-password" placeholder="At least 8 characters" autocomplete="new-password"></div>\'+' +
  '\'<div class="auth-field"><label>Confirm New Password</label><input type="password" id="clms-rc-confirm" placeholder="Re-enter new password" autocomplete="new-password"></div>\'+' +
  '\'<button class="btn-auth" id="clms-rc-submit">Set New Password</button>\'+' +
  '\'<div class="auth-note" id="clmsResetConfirmNote"></div>\';' +
  'authCard.appendChild(confirmView);' +
  'var resetToken=null;' +
  'try{var params=new URLSearchParams(location.search);resetToken=params.get("reset_token");}catch(e){}' +
  'function showConfirmView(){' +
  'var loginView=document.getElementById("loginView");' +
  'if(loginView){loginView.style.display="none";}' +
  'resetView.style.display="none";' +
  'confirmView.style.display="block";' +
  '}' +
  'function backToLogin(){' +
  'confirmView.style.display="none";' +
  'resetView.style.display="none";' +
  'var loginView=document.getElementById("loginView");' +
  'if(loginView){loginView.style.display="block";}' +
  '}' +
  'document.getElementById("clms-rc-submit").addEventListener("click",function(){' +
  'var password=document.getElementById("clms-rc-password").value;' +
  'var confirmPassword=document.getElementById("clms-rc-confirm").value;' +
  'var note=document.getElementById("clmsResetConfirmNote");' +
  'note.classList.add("show");' +
  'if(!password||password.length<8){note.textContent="Password must be at least 8 characters.";return;}' +
  'if(password!==confirmPassword){note.textContent="Passwords do not match.";return;}' +
  'if(!resetToken){note.textContent="This reset link is missing its token. Please use the link from your email.";return;}' +
  'var btn=document.getElementById("clms-rc-submit");' +
  'btn.disabled=true;' +
  'note.textContent="Updating your password...";' +
  'fetch("/api/reset-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:resetToken,password:password,confirmPassword:confirmPassword})})' +
  '.then(function(r){return r.json().then(function(d){return {ok:r.ok,data:d};});})' +
  '.then(function(res){' +
  'btn.disabled=false;' +
  'if(res.ok&&res.data&&res.data.ok){' +
  'note.textContent="Password updated — you can log in now.";' +
  'document.getElementById("clms-rc-password").value="";' +
  'document.getElementById("clms-rc-confirm").value="";' +
  'setTimeout(backToLogin,1800);' +
  '}else{' +
  'note.textContent=(res.data&&res.data.error)||"That reset link is invalid or expired.";' +
  '}' +
  '})' +
  '.catch(function(){' +
  'btn.disabled=false;' +
  'note.textContent="Something went wrong. Please try again.";' +
  '});' +
  '});' +
  'window.submitAuthReset=function(){' +
  'var emailInput=document.getElementById("reset-email");' +
  'var email=emailInput?emailInput.value.trim():"";' +
  'var note=document.getElementById("resetNote");' +
  'note.classList.add("show");' +
  'if(!email){note.textContent="Please enter your email address.";return;}' +
  'note.textContent="Sending reset link...";' +
  'fetch("/api/forgot-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:email})})' +
  '.then(function(r){return r.json();})' +
  '.then(function(d){' +
  'note.textContent=(d&&d.message)||"If an account exists for that email, we\'ve sent a reset link.";' +
  '})' +
  '.catch(function(){' +
  'note.textContent="Something went wrong. Please try again.";' +
  '});' +
  '};' +
  'if(resetToken){' +
  'if(typeof navigateToOverlay==="function"){navigateToOverlay("#login");}' +
  'else{var overlay=document.getElementById("loginOverlay");if(overlay){overlay.classList.add("open");}}' +
  'showConfirmView();' +
  '}' +
  '});' +
  '})();' +
  '<' + '/script>';

const DEMO_FIX_SCRIPT = '<script>' +
  '(function(){' +
  'function ready(fn){if(document.readyState!=="loading"){fn();}else{document.addEventListener("DOMContentLoaded",fn);}}' +
  'ready(function(){' +
  'var frame=document.getElementById("dashboardFrame");' +
  'if(!frame){return;}' +
  'var loaded=false;' +
  'window.loadDemoIfNeeded=function(){' +
  'if(loaded){return;}' +
  'loaded=true;' +
  'var loading=document.getElementById("demoLoading");' +
  'fetch("/api/demo-dashboard").then(function(r){' +
  'if(!r.ok){throw new Error("bad status");}' +
  'return r.text();' +
  '}).then(function(html){' +
  'frame.srcdoc=html;' +
  'frame.addEventListener("load",function(){' +
  'if(loading){loading.classList.add("hide");}' +
  '},{once:true});' +
  '}).catch(function(){' +
  'loaded=false;' +
  'if(loading){loading.textContent="Couldn\'t load the demo right now — please try again shortly.";}' +
  '});' +
  '};' +
  'if(location.hash==="#demo"){window.loadDemoIfNeeded();}' +
  '});' +
  '})();' +
  '<' + '/script>';

const PROCESS_EXPLAINER_HTML = '<div class="clms-process-explainer">' +
  '<div class="section-head" style="margin-bottom:36px;">' +
  '<div class="eyebrow">Get Started</div>' +
  '<h2 style="font-size:26px;">From sign-up to a working dashboard</h2>' +
  '<p>Here\'s exactly what happens after you click Get Started.</p>' +
  '</div>' +
  '<div class="steps-row" style="margin-bottom:56px;">' +
  '<div class="step-card">' +
  '<div class="step-num">1</div>' +
  '<h3>Create Your Account</h3>' +
  '<p>Sign up using your company\'s work domain email so we can verify your business and connect you with your team.</p>' +
  '</div>' +
  '<div class="step-card">' +
  '<div class="step-num">2</div>' +
  '<h3>Submit Payment</h3>' +
  '<p>Choose the plan that fits your AR volume and submit payment to activate your account.</p>' +
  '</div>' +
  '<div class="step-card">' +
  '<div class="step-num">3</div>' +
  '<h3>Implementation Period</h3>' +
  '<p>Our team configures your offices, departments, and integrations during a short onboarding window.</p>' +
  '</div>' +
  '<div class="step-card">' +
  '<div class="step-num">4</div>' +
  '<h3>Log In &amp; Get Results</h3>' +
  '<p>Receive your clAIms login and dashboard access, then watch your outstanding AR start moving.</p>' +
  '</div>' +
  '</div>' +
  '</div>';

const CONTACT_FORM_SCRIPT = '<script>' +
  '(function(){' +
  'function ready(fn){if(document.readyState!=="loading"){fn();}else{document.addEventListener("DOMContentLoaded",fn);}}' +
  'ready(function(){' +
  'var headerBtns=document.querySelectorAll(\'a.btn-header-primary[href="#contact"]\');' +
  'for(var i=0;i<headerBtns.length;i++){headerBtns[i].textContent="Contact Us";}' +
  'var card=document.querySelector(".contact-card");' +
  'if(!card){return;}' +
  'card.innerHTML=' +
  '\'<div class="c-field">\'+' +
  '\'<label>Full Name</label>\'+' +
  '\'<input type="text" id="c-name" placeholder="Jane Smith">\'+' +
  '\'</div>\'+' +
  '\'<div class="c-field">\'+' +
  '\'<label>Work Email</label>\'+' +
  '\'<input type="email" id="c-email" placeholder="jane@yourcompany.com">\'+' +
  '\'</div>\'+' +
  '\'<div class="c-field">\'+' +
  '\'<label>Company</label>\'+' +
  '\'<input type="text" id="c-company" placeholder="Your Company Name">\'+' +
  '\'</div>\'+' +
  '\'<div class="c-field">\'+' +
  '\'<label>What can we help you with?</label>\'+' +
  '\'<select id="c-help-topic">\'+' +
  '\'<option value="login">Login help</option>\'+' +
  '\'<option value="account">Account help</option>\'+' +
  '\'<option value="status">Check status of my account set up</option>\'+' +
  '\'<option value="other">Other</option>\'+' +
  '\'</select>\'+' +
  '\'</div>\'+' +
  '\'<div class="c-field" id="c-help-other-wrap" style="display:none;">\'+' +
  '\'<label>Please tell us more</label>\'+' +
  '\'<textarea id="c-help-other" placeholder="Tell us what you need help with..."></textarea>\'+' +
  '\'</div>\'+' +
  '\'<div class="c-field">\'+' +
  '\'<label>Anything you\\\'d like us to know? <span style="text-transform:none;font-weight:400;">(optional)</span></label>\'+' +
  '\'<textarea id="c-message" placeholder="Anything else we should know..."></textarea>\'+' +
  '\'</div>\'+' +
  '\'<button class="btn-primary contact-submit" onclick="submitContact()">Send inquiry →</button>\'+' +
  '\'<div class="contact-note">This opens your email client with these details filled in, addressed to <b id="contactEmailDisplay">info@claims-collection.net</b>.</div>\';' +
  'var topicSelect=document.getElementById("c-help-topic");' +
  'var otherWrap=document.getElementById("c-help-other-wrap");' +
  'function syncOther(){otherWrap.style.display=(topicSelect.value==="other")?"block":"none";}' +
  'topicSelect.addEventListener("change",syncOther);' +
  'syncOther();' +
  'var TOPIC_LABELS={login:"Login help",account:"Account help",status:"Check status of my account set up",other:"Other"};' +
  'window.submitContact=function(){' +
  'var name=document.getElementById("c-name").value.trim();' +
  'var email=document.getElementById("c-email").value.trim();' +
  'var company=document.getElementById("c-company").value.trim();' +
  'var topic=document.getElementById("c-help-topic").value;' +
  'var otherEl=document.getElementById("c-help-other");' +
  'var otherDetail=otherEl?otherEl.value.trim():"";' +
  'var messageEl=document.getElementById("c-message");' +
  'var message=messageEl?messageEl.value.trim():"";' +
  'if(!name||!email){alert("Please enter your name and work email so we know who to follow up with.");return;}' +
  'var topicLabel=TOPIC_LABELS[topic]||topic;' +
  'var subject="New inquiry — "+topicLabel+" — "+(company||name);' +
  'var bodyLines=["Name: "+name,"Email: "+email,"Company: "+(company||"(not provided)"),"What can we help with: "+topicLabel];' +
  'if(topic==="other"&&otherDetail){bodyLines.push("Details: "+otherDetail);}' +
  'bodyLines.push("");' +
  'bodyLines.push("Anything else: "+(message||"(none)"));' +
  'var body=bodyLines.join("\\n");' +
  'var contactEmail="info@claims-collection.net";' +
  'try{if(typeof CONTACT_EMAIL!=="undefined"&&CONTACT_EMAIL){contactEmail=CONTACT_EMAIL;}}catch(e){}' +
  'var mailto="mailto:"+contactEmail+"?subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(body);' +
  'window.location.href=mailto;' +
  '};' +
  '});' +
  '})();' +
  '<' + '/script>';

const GET_STARTED_FORM_SCRIPT = '<script>' +
  '(function(){' +
  'function ready(fn){if(document.readyState!=="loading"){fn();}else{document.addEventListener("DOMContentLoaded",fn);}}' +
  'ready(function(){' +
  'var headerBtns=document.querySelectorAll(\'[onclick="openSignup()"]\');' +
  'for(var i=0;i<headerBtns.length;i++){headerBtns[i].textContent="Get Started";}' +
  'var eyebrow=document.querySelector("#signupOverlay .auth-eyebrow");' +
  'if(eyebrow){eyebrow.textContent="Get Started";}' +
  'var formFields=document.getElementById("signupFormFields");' +
  'if(!formFields){return;}' +
  'var pwField=document.getElementById("su-password");' +
  'if(pwField){var pwWrap=pwField.closest(".auth-field");if(pwWrap&&pwWrap.parentNode){pwWrap.parentNode.removeChild(pwWrap);}}' +
  'var cpwField=document.getElementById("su-confirm-password");' +
  'if(cpwField){var cpwWrap=cpwField.closest(".auth-field");if(cpwWrap&&cpwWrap.parentNode){cpwWrap.parentNode.removeChild(cpwWrap);}}' +
  'var sizeField=document.getElementById("su-size");' +
  'var sizeWrap=sizeField?sizeField.closest(".auth-field"):null;' +
  'var planWrap=document.createElement("div");' +
  'planWrap.className="auth-field";' +
  'planWrap.innerHTML=' +
  '\'<label>Desired Plan</label>\'+' +
  '\'<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:4px;">\'+' +
  '\'<label style="display:flex;align-items:center;gap:6px;font-weight:400;text-transform:none;letter-spacing:0;font-size:14px;"><input type="radio" name="su-plan-choice" value="starter" style="width:auto;">Starter</label>\'+' +
  '\'<label style="display:flex;align-items:center;gap:6px;font-weight:400;text-transform:none;letter-spacing:0;font-size:14px;"><input type="radio" name="su-plan-choice" value="growth" style="width:auto;">Growth</label>\'+' +
  '\'<label style="display:flex;align-items:center;gap:6px;font-weight:400;text-transform:none;letter-spacing:0;font-size:14px;"><input type="radio" name="su-plan-choice" value="enterprise" style="width:auto;">Enterprise</label>\'+' +
  '\'</div>\';' +
  'if(sizeWrap&&sizeWrap.parentNode){sizeWrap.parentNode.insertBefore(planWrap,sizeWrap.nextSibling);}else{formFields.appendChild(planWrap);}' +
  'var submitBtn=document.getElementById("su-submit-btn");' +
  'if(!submitBtn){return;}' +
  'submitBtn.textContent="Get Started";' +
  'submitBtn.style.display="none";' +
  'function fieldVal(id){var el=document.getElementById(id);return el?el.value.trim():"";}' +
  'function checkComplete(){' +
  'var complete=!!(' +
  'fieldVal("su-fullname")&&' +
  'fieldVal("su-email")&&' +
  'fieldVal("su-company")&&' +
  'fieldVal("su-address")&&' +
  'fieldVal("su-city")&&' +
  'fieldVal("su-state")&&' +
  'fieldVal("su-zip")&&' +
  'fieldVal("su-size")&&' +
  'document.querySelector(\'input[name="su-plan-choice"]:checked\')&&' +
  '(document.getElementById("su-terms")&&document.getElementById("su-terms").checked)' +
  ');' +
  'submitBtn.style.display=complete?"inline-block":"none";' +
  '}' +
  'formFields.addEventListener("input",checkComplete);' +
  'formFields.addEventListener("change",checkComplete);' +
  'checkComplete();' +
  'window.submitSignup=function(){' +
  'var note=document.getElementById("signupNote");' +
  'var planEl=document.querySelector(\'input[name="su-plan-choice"]:checked\');' +
  'var payload={' +
  'fullName:fieldVal("su-fullname"),' +
  'email:fieldVal("su-email"),' +
  'companyName:fieldVal("su-company"),' +
  'address:fieldVal("su-address"),' +
  'city:fieldVal("su-city"),' +
  'state:fieldVal("su-state"),' +
  'zip:fieldVal("su-zip"),' +
  'companySize:fieldVal("su-size"),' +
  'desiredPlan:planEl?planEl.value:"",' +
  'agreeToTerms:(document.getElementById("su-terms")?document.getElementById("su-terms").checked:false)' +
  '};' +
  'if(!payload.fullName||!payload.email||!payload.companyName||!payload.desiredPlan||!payload.agreeToTerms){' +
  'if(note){note.classList.add("show");note.textContent="Please complete all fields and agree to the Terms & Conditions.";}' +
  'return;' +
  '}' +
  'submitBtn.disabled=true;submitBtn.textContent="Submitting...";' +
  'fetch("/api/get-started",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)})' +
  '.then(function(r){return r.json().then(function(d){return {ok:r.ok,data:d};});})' +
  '.then(function(res){' +
  'if(res.ok&&res.data&&res.data.ok){' +
  'window.location.href="/thank-you";' +
  '}else{' +
  'submitBtn.disabled=false;submitBtn.textContent="Get Started";' +
  'if(note){note.classList.add("show");note.textContent=(res.data&&res.data.error)||"Something went wrong. Please try again.";}' +
  '}' +
  '})' +
  '.catch(function(){' +
  'submitBtn.disabled=false;submitBtn.textContent="Get Started";' +
  'if(note){note.classList.add("show");note.textContent="Network error. Please try again.";}' +
  '});' +
  '};' +
  '});' +
  '})();' +
  '<' + '/script>';

const THANK_YOU_HTML = '<!doctype html><html lang="en"><head><meta charset="UTF-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>Thank you — clAIms</title>' +
  '<link rel="icon" href="/favicon.ico">' +
  '<style>' +
  'body{margin:0;font-family:"IBM Plex Sans",Arial,sans-serif;background:#F5F2EA;color:#171717;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;box-sizing:border-box;}' +
  '.ty-card{background:#fff;border:1px solid #E5E0D2;border-radius:16px;padding:48px 40px;max-width:520px;text-align:center;box-shadow:0 24px 60px -20px rgba(23,23,23,0.15);}' +
  '.ty-card .ty-mark{font-size:14px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#C29B57;margin-bottom:18px;}' +
  '.ty-card h1{font-size:26px;margin:0 0 16px;}' +
  '.ty-card p{font-size:15px;line-height:1.6;color:#3B3A35;margin:0 0 28px;}' +
  '.ty-card a{display:inline-block;background:#171717;color:#fff;text-decoration:none;font-weight:600;padding:12px 26px;border-radius:8px;}' +
  '.ty-card a:hover{opacity:.88;}' +
  '</style></head><body>' +
  '<div class="ty-card">' +
  '<div class="ty-mark">clAIms</div>' +
  '<h1>Thank you for your submission!</h1>' +
  '<p>Please allow adequate time for the clAIms collection team to reach out to you to begin the setup process.</p>' +
  '<a href="/">Back to home</a>' +
  '</div>' +
  '</body></html>';

const PRICING_LINKS_SCRIPT = '<script>' +
  '(function(){' +
  'function ready(fn){if(document.readyState!=="loading"){fn();}else{document.addEventListener("DOMContentLoaded",fn);}}' +
  'ready(function(){' +
  'var tiersRow=document.getElementById("tiersRow");' +
  'if(!tiersRow){return;}' +
  'var stripeLinks=tiersRow.querySelectorAll(\'a[href^="https://buy.stripe.com"]\');' +
  'for(var i=0;i<stripeLinks.length;i++){' +
  '(function(a){' +
  'a.removeAttribute("href");' +
  'a.style.cursor="pointer";' +
  'a.addEventListener("click",function(e){' +
  'e.preventDefault();' +
  'if(typeof openSignup==="function"){openSignup();}' +
  '});' +
  '})(stripeLinks[i]);' +
  '}' +
  '});' +
  '})();' +
  '<' + '/script>';

function planForSize(size) {
  if (size === '1-10') return 'starter';
  if (size === '11-50') return 'growth';
  return 'enterprise';
}

function toHex(buf) {
  return Array.from(new Uint8Array(buf)).map(function(b){ return b.toString(16).padStart(2, '0'); }).join('');
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const salt = fromHex(saltHex);
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return toHex(bits);
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toHex(bytes.buffer);
}

function randomSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return toHex(bytes.buffer);
}

function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const out = {};
  header.split(';').forEach(function(part) {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function slugify(name) {
  const s = String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return s || 'company';
}

function emailDomain(email) {
  const parts = String(email).toLowerCase().split('@');
  return parts.length === 2 ? parts[1] : '';
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, function(c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': NO_STORE } });
}

function redirectTo(target) {
  const location = target.indexOf('http') === 0 ? target : (SITE_URL + target);
  return new Response(null, { status: 302, headers: { 'Location': location, 'Cache-Control': NO_STORE } });
}

async function injectHelpWidget(response) {
  const contentType = response.headers.get('Content-Type') || '';
  if (contentType.indexOf('text/html') === -1) return response;
  return new HTMLRewriter()
    .on('body', {
      element: function(el) {
        el.append(HELP_WIDGET_HTML, { html: true });
        el.append(RESET_PASSWORD_SCRIPT, { html: true });
        el.append(DEMO_FIX_SCRIPT, { html: true });
        el.append(CONTACT_FORM_SCRIPT, { html: true });
        el.append(GET_STARTED_FORM_SCRIPT, { html: true });
        el.append(PRICING_LINKS_SCRIPT, { html: true });
      }
    })
    .on('#tiersRow', {
      element: function(el) {
        el.before(PROCESS_EXPLAINER_HTML, { html: true });
      }
    })
    .transform(response);
}

async function handleDemoDashboard(request, env) {
  const assetResponse = await env.ASSETS.fetch(new URL('/dashboard.html', request.url));
  const html = await assetResponse.text();
  return new Response(html, {
    status: assetResponse.status,
    headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'public, max-age=300' }
  });
}

async function uniqueSlug(env, base) {
  let slug = base;
  let n = 1;
  while (true) {
    const row = await env.DB.prepare('SELECT id FROM tenants WHERE slug = ?').bind(slug).first();
    if (!row) return slug;
    n++;
    slug = base + '-' + n;
  }
}

async function sendEmail(env, opts) {
  const to = opts.to, subject = opts.subject, html = opts.html, kind = opts.kind, tenantId = opts.tenantId, userId = opts.userId, replyTo = opts.replyTo;
  if (!env.RESEND_API_KEY) {
    try {
      await env.DB.prepare(
        'INSERT INTO email_log (to_email, subject, kind, tenant_id, user_id, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(to, subject, kind, tenantId || null, userId || null, 'skipped', 'RESEND_API_KEY not configured').run();
    } catch (e) {}
    return { ok: false, skipped: true };
  }
  try {
    const payload = { from: FROM_EMAIL, to: [to], subject: subject, html: html };
    if (replyTo) payload.reply_to = replyTo;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const ok = res.ok;
    let errText = '';
    if (!ok) errText = await res.text();
    await env.DB.prepare(
      'INSERT INTO email_log (to_email, subject, kind, tenant_id, user_id, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(to, subject, kind, tenantId || null, userId || null, ok ? 'sent' : 'failed', ok ? null : errText.slice(0, 500)).run();
    return { ok: ok };
  } catch (e) {
    try {
      await env.DB.prepare(
        'INSERT INTO email_log (to_email, subject, kind, tenant_id, user_id, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(to, subject, kind, tenantId || null, userId || null, 'failed', String(e).slice(0, 500)).run();
    } catch (e2) {}
    return { ok: false, error: String(e) };
  }
}

async function getSessionUser(request, env) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const row = await env.DB.prepare(
    'SELECT u.id, u.email, u.role, u.tenant_id, u.status AS user_status, u.email_verified, ' +
    't.slug AS tenant_slug, t.company_name, t.status AS tenant_status, t.integration_status, s.expires_at ' +
    'FROM sessions s ' +
    'JOIN users u ON u.id = s.user_id ' +
    'JOIN tenants t ON t.id = u.tenant_id ' +
    'WHERE s.token = ?'
  ).bind(token).first();
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  return row;
}

async function handleSupportRequest(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'Invalid request body' }, 400); }

  const name = (body.name || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const message = (body.message || '').trim();
  const page = String(body.page || '').slice(0, 300);

  if (!name || !email || !message) {
    return json({ ok: false, error: 'Please fill out your name, email, and message.' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'Please enter a valid email address.' }, 400);
  }
  if (name.length > 200 || message.length > 4000) {
    return json({ ok: false, error: 'That message is too long.' }, 400);
  }

  const user = await getSessionUser(request, env);

  const notifyHtml =
    '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">' +
    '<h2>New support request</h2>' +
    '<table style="border-collapse:collapse;width:100%;">' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Name</td><td style="padding:4px 8px;">' + escapeHtml(name) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Email</td><td style="padding:4px 8px;">' + escapeHtml(email) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Page</td><td style="padding:4px 8px;">' + escapeHtml(page) + '</td></tr>' +
    (user ? '<tr><td style="padding:4px 8px;font-weight:600;">Logged in as</td><td style="padding:4px 8px;">' + escapeHtml(user.email) + ' (' + escapeHtml(user.company_name || '') + ')</td></tr>' : '') +
    '</table>' +
    '<p style="white-space:pre-wrap;padding:14px 16px;background:#F5F2EA;border-radius:8px;margin-top:14px;">' + escapeHtml(message) + '</p>' +
    '</div>';
  await sendEmail(env, {
    to: SUPPORT_EMAIL,
    subject: 'Support request from ' + name,
    html: notifyHtml,
    kind: 'support_request',
    replyTo: email,
    tenantId: user ? user.tenant_id : null,
    userId: user ? user.id : null
  });

  const confirmHtml =
    '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">' +
    '<h2 style="color:#171717;">We got your message</h2>' +
    '<p>Hi ' + escapeHtml(name) + ',</p>' +
    '<p>Thanks for reaching out to clAIms support. A member of our team will reply to this email within one business day.</p>' +
    '<p style="color:#666;font-size:13px;">Your message: &ldquo;' + escapeHtml(message.slice(0, 300)) + '&rdquo;</p>' +
    '</div>';
  await sendEmail(env, { to: email, subject: 'We got your message — clAIms support', html: confirmHtml, kind: 'support_confirmation' });

  return json({ ok: true, message: 'Thanks — we got your message.' });
}

async function handleForgotPassword(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'Invalid request body' }, 400); }

  const email = (body.email || '').trim().toLowerCase();
  const genericMessage = "If an account exists for that email, we've sent a reset link.";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'Please enter a valid email address.' }, 400);
  }

  const user = await env.DB.prepare('SELECT * FROM users WHERE lower(email) = ?').bind(email).first();
  if (user) {
    const token = randomToken();
    const expires = new Date(Date.now() + RESET_TTL_SECONDS * 1000).toISOString();
    await env.DB.prepare('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?').bind(token, expires, user.id).run();

    const resetUrl = SITE_URL + '/?reset_token=' + token + '#login';
    const resetHtml =
      '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">' +
      '<h2 style="color:#171717;">Reset your password</h2>' +
      '<p>Hi ' + escapeHtml(user.full_name || '') + ',</p>' +
      '<p>We received a request to reset the password for your clAIms account. Click below to choose a new password.</p>' +
      '<p style="margin:28px 0;"><a href="' + resetUrl + '" style="background:#171717;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;">Reset password</a></p>' +
      '<p style="color:#666;font-size:13px;">This link expires in 1 hour. If you did not request this, you can safely ignore this email — your password will not be changed.</p>' +
      '</div>';
    await sendEmail(env, {
      to: user.email,
      subject: 'Reset your clAIms password',
      html: resetHtml,
      kind: 'password_reset',
      tenantId: user.tenant_id,
      userId: user.id
    });
  }

  return json({ ok: true, message: genericMessage });
}

async function handleResetPassword(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'Invalid request body' }, 400); }

  const token = (body.token || '').trim();
  const password = body.password || '';
  const confirmPassword = body.confirmPassword || '';

  if (!token) {
    return json({ ok: false, error: 'Missing reset token.' }, 400);
  }
  if (!password || password.length < 8) {
    return json({ ok: false, error: 'Password must be at least 8 characters.' }, 400);
  }
  if (password !== confirmPassword) {
    return json({ ok: false, error: 'Passwords do not match.' }, 400);
  }

  const user = await env.DB.prepare('SELECT * FROM users WHERE reset_token = ?').bind(token).first();
  if (!user) {
    return json({ ok: false, error: 'That reset link is invalid or has already been used.' }, 400);
  }
  if (!user.reset_expires || new Date(user.reset_expires) < new Date()) {
    return json({ ok: false, error: 'That reset link has expired. Please request a new one.' }, 400);
  }

  const salt = randomSalt();
  const passwordHash = await hashPassword(password, salt);
  await env.DB.prepare(
    'UPDATE users SET password_hash = ?, salt = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?'
  ).bind(passwordHash, salt, user.id).run();
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();

  return json({ ok: true, message: 'Password updated successfully.' });
}

async function handleSignup(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'Invalid request body' }, 400); }

  const fullName = (body.fullName || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const confirmPassword = body.confirmPassword || '';
  const companyName = (body.companyName || '').trim();
  const address = (body.address || '').trim();
  const city = (body.city || '').trim();
  const state = (body.state || '').trim();
  const zip = (body.zip || '').trim();
  const companySize = (body.companySize || '').trim();

  if (!fullName || !email || !password || !companyName || !companySize) {
    return json({ ok: false, error: 'Please fill out all required fields.' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'Please enter a valid email address.' }, 400);
  }
  if (password.length < 8) {
    return json({ ok: false, error: 'Password must be at least 8 characters.' }, 400);
  }
  if (password !== confirmPassword) {
    return json({ ok: false, error: 'Passwords do not match.' }, 400);
  }
  if (!body.agreeToTerms) {
    return json({ ok: false, error: 'You must agree to the Terms & Conditions to create an account.' }, 400);
  }

  const existingUser = await env.DB.prepare('SELECT id FROM users WHERE lower(email) = ?').bind(email).first();
  if (existingUser) {
    return json({ ok: false, error: 'An account with this email already exists.' }, 409);
  }

  const domain = emailDomain(email);
  const isPersonalDomain = PERSONAL_EMAIL_DOMAINS.has(domain);

  const salt = randomSalt();
  const passwordHash = await hashPassword(password, salt);
  const verificationToken = randomToken();
  const verificationExpires = new Date(Date.now() + VERIFICATION_TTL_SECONDS * 1000).toISOString();

  let tenant = null;
  let isNewTenant = false;
  let userRole = 'admin';
  let userStatus = 'pending_verification';

  if (!isPersonalDomain) {
    tenant = await env.DB.prepare('SELECT * FROM tenants WHERE domain = ?').bind(domain).first();
  }

  if (tenant) {
    userRole = 'user';
    userStatus = 'pending_approval';
  } else {
    isNewTenant = true;
    const recommendedPlan = planForSize(companySize);
    const slug = await uniqueSlug(env, slugify(companyName));
    const insertTenant = await env.DB.prepare(
      "INSERT INTO tenants (slug, company_name, domain, address, city, state, zip, company_size, recommended_plan, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_verification')"
    ).bind(slug, companyName, isPersonalDomain ? null : domain, address, city, state, zip, companySize, recommendedPlan).run();
    const tenantId = insertTenant.meta.last_row_id;
    tenant = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(tenantId).first();
  }

  const acceptedAt = new Date().toISOString();
  const acceptedIp = request.headers.get('CF-Connecting-IP') || '';
  const insertUser = await env.DB.prepare(
    'INSERT INTO users (tenant_id, email, password_hash, salt, role, status, email_verified, verification_token, verification_expires, full_name, terms_accepted_at, terms_accepted_ip, terms_version) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)'
  ).bind(tenant.id, email, passwordHash, salt, userRole, userStatus, verificationToken, verificationExpires, fullName, acceptedAt, acceptedIp, 'v1').run();
  const userId = insertUser.meta.last_row_id;

  if (isNewTenant) {
    await env.DB.prepare('UPDATE tenants SET admin_user_id = ? WHERE id = ?').bind(userId, tenant.id).run();
  }

  const verifyUrl = SITE_URL + '/api/verify-email?token=' + verificationToken;
  const verifyHtml =
    '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">' +
    '<h2 style="color:#171717;">Verify your email</h2>' +
    '<p>Hi ' + escapeHtml(fullName) + ',</p>' +
    '<p>Thanks for signing up for clAIms' + (isNewTenant ? '' : ' — ' + escapeHtml(tenant.company_name)) + '. Click below to verify your email and continue setup.</p>' +
    '<p style="margin:28px 0;"><a href="' + verifyUrl + '" style="background:#171717;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;">Verify email</a></p>' +
    '<p style="color:#666;font-size:13px;">This link expires in 24 hours. If you did not request this, you can ignore this email.</p>' +
    '</div>';
  await sendEmail(env, { to: email, subject: 'Verify your email for clAIms', html: verifyHtml, kind: 'verify_email', tenantId: tenant.id, userId: userId });

  const notifyHtml =
    '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">' +
    '<h2>New Create Account submission</h2>' +
    '<table style="border-collapse:collapse;width:100%;">' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Full name</td><td style="padding:4px 8px;">' + escapeHtml(fullName) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Email</td><td style="padding:4px 8px;">' + escapeHtml(email) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Company</td><td style="padding:4px 8px;">' + escapeHtml(companyName) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Address</td><td style="padding:4px 8px;">' + escapeHtml(address) + ', ' + escapeHtml(city) + ', ' + escapeHtml(state) + ' ' + escapeHtml(zip) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Company size</td><td style="padding:4px 8px;">' + escapeHtml(companySize) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Recommended plan</td><td style="padding:4px 8px;">' + escapeHtml(tenant.recommended_plan || 'n/a') + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Signup type</td><td style="padding:4px 8px;">' + (isNewTenant ? 'New company (' + escapeHtml(tenant.slug) + ')' : 'Joined existing company: ' + escapeHtml(tenant.company_name) + ' (pending admin approval)') + '</td></tr>' +
    '</table>' +
    '</div>';
  await sendEmail(env, { to: NOTIFY_EMAIL, subject: 'New signup: ' + companyName + ' (' + email + ')', html: notifyHtml, kind: 'signup_notification', tenantId: tenant.id, userId: userId });

  return json({ ok: true, message: 'Check your email to verify your account.', joinedExisting: !isNewTenant });
}

async function handleGetStarted(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'Invalid request body' }, 400); }

  const fullName = (body.fullName || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const companyName = (body.companyName || '').trim();
  const address = (body.address || '').trim();
  const city = (body.city || '').trim();
  const state = (body.state || '').trim();
  const zip = (body.zip || '').trim();
  const companySize = (body.companySize || '').trim();
  const desiredPlan = (body.desiredPlan || '').trim();

  if (!fullName || !email || !companyName || !desiredPlan) {
    return json({ ok: false, error: 'Please fill out all required fields.' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'Please enter a valid email address.' }, 400);
  }
  if (['starter', 'growth', 'enterprise'].indexOf(desiredPlan) === -1) {
    return json({ ok: false, error: 'Please select a valid plan.' }, 400);
  }
  if (!body.agreeToTerms) {
    return json({ ok: false, error: 'You must agree to the Terms & Conditions to continue.' }, 400);
  }

  const notifyHtml =
    '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">' +
    '<h2>New Get Started submission</h2>' +
    '<table style="border-collapse:collapse;width:100%;">' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Full name</td><td style="padding:4px 8px;">' + escapeHtml(fullName) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Email</td><td style="padding:4px 8px;">' + escapeHtml(email) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Company</td><td style="padding:4px 8px;">' + escapeHtml(companyName) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Address</td><td style="padding:4px 8px;">' + escapeHtml(address) + ', ' + escapeHtml(city) + ', ' + escapeHtml(state) + ' ' + escapeHtml(zip) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Company size</td><td style="padding:4px 8px;">' + escapeHtml(companySize) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Desired plan</td><td style="padding:4px 8px;">' + escapeHtml(desiredPlan) + '</td></tr>' +
    '</table>' +
    '</div>';
  const result = await sendEmail(env, {
    to: 'info@claims-collection.net',
    subject: 'NEW CUSTOMER ' + companyName,
    html: notifyHtml,
    kind: 'get_started_lead'
  });

  return json({ ok: true, message: 'Thanks — our team will be in touch shortly.', emailSent: !!result.ok });
}

async function handleThankYou(request, env) {
  return injectHelpWidget(new Response(THANK_YOU_HTML, { headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': NO_STORE } }));
}

async function handleVerifyEmail(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';
  if (!token) return redirectTo('/?verify=missing');

  const user = await env.DB.prepare('SELECT * FROM users WHERE verification_token = ?').bind(token).first();
  if (!user) return redirectTo('/?verify=invalid');
  if (user.verification_expires && new Date(user.verification_expires) < new Date()) {
    return redirectTo('/?verify=expired');
  }

  await env.DB.prepare('UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?').bind(user.id).run();

  const tenant = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(user.tenant_id).first();

  if (tenant && user.role === 'admin' && tenant.admin_user_id === user.id) {
    const plan = tenant.recommended_plan || 'starter';
    const link = STRIPE_LINKS[plan];
    if (!link) {
      await env.DB.prepare("UPDATE tenants SET status = 'verified' WHERE id = ?").bind(tenant.id).run();
      return redirectTo('/?verify=enterprise');
    }
    await env.DB.prepare("UPDATE tenants SET status = 'payment_pending' WHERE id = ?").bind(tenant.id).run();
    const paymentUrl = link + '?prefilled_email=' + encodeURIComponent(user.email) + '&client_reference_id=' + tenant.id;
    return redirectTo(paymentUrl);
  }

  return redirectTo('/?verify=pending-approval');
}

async function handlePendingApprovals(request, env) {
  const admin = await getSessionUser(request, env);
  if (!admin || admin.role !== 'admin') return json({ ok: false, error: 'Not authorized' }, 403);
  const results = await env.DB.prepare(
    "SELECT id, email, full_name, status, created_at FROM users WHERE tenant_id = ? AND status = 'pending_approval'"
  ).bind(admin.tenant_id).all();
  return json({ ok: true, pending: results.results });
}

async function handleApproveUser(request, env) {
  const admin = await getSessionUser(request, env);
  if (!admin || admin.role !== 'admin') return json({ ok: false, error: 'Not authorized' }, 403);
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'Invalid body' }, 400); }
  const targetId = body.userId;
  const target = await env.DB.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').bind(targetId, admin.tenant_id).first();
  if (!target) return json({ ok: false, error: 'User not found' }, 404);
  await env.DB.prepare("UPDATE users SET status = 'active' WHERE id = ?").bind(targetId).run();
  return json({ ok: true });
}

async function handleRejectUser(request, env) {
  const admin = await getSessionUser(request, env);
  if (!admin || admin.role !== 'admin') return json({ ok: false, error: 'Not authorized' }, 403);
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'Invalid body' }, 400); }
  const targetId = body.userId;
  const target = await env.DB.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').bind(targetId, admin.tenant_id).first();
  if (!target) return json({ ok: false, error: 'User not found' }, 404);
  await env.DB.prepare("UPDATE users SET status = 'rejected' WHERE id = ?").bind(targetId).run();
  return json({ ok: true });
}

async function verifyStripeSignature(env, sigHeader, rawBody) {
  if (!env.STRIPE_WEBHOOK_SECRET) return false;
  const parts = {};
  sigHeader.split(',').forEach(function(p) {
    const idx = p.indexOf('=');
    if (idx === -1) return;
    parts[p.slice(0, idx)] = p.slice(idx + 1);
  });
  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) return false;
  const signedPayload = timestamp + '.' + rawBody;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(signedPayload));
  const expected = toHex(sigBuf);
  return expected === v1;
}

async function handleStripeWebhook(request, env) {
  const rawBody = await request.text();
  const sigHeader = request.headers.get('Stripe-Signature') || '';
  const valid = await verifyStripeSignature(env, sigHeader, rawBody);
  if (!valid) {
    return new Response('Invalid signature', { status: 400 });
  }
  let event;
  try { event = JSON.parse(rawBody); } catch (e) { return new Response('Bad payload', { status: 400 }); }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const tenantId = session.client_reference_id;
    if (tenantId) {
      await env.DB.prepare(
        "UPDATE tenants SET status = 'active', integration_status = 'not_started', stripe_customer_id = ? WHERE id = ?"
      ).bind(session.customer || null, tenantId).run();
      await env.DB.prepare(
        "UPDATE users SET status = 'active' WHERE tenant_id = ? AND role = 'admin'"
      ).bind(tenantId).run();

      const tenant = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(tenantId).first();
      if (tenant) {
        const notifyHtml = '<div style="font-family:sans-serif;"><h2>Payment received</h2><p>' + escapeHtml(tenant.company_name) + ' has completed payment and is now active. Plan: ' + escapeHtml(tenant.selected_plan || tenant.recommended_plan || 'n/a') + '.</p></div>';
        await sendEmail(env, { to: NOTIFY_EMAIL, subject: 'Payment received: ' + tenant.company_name, html: notifyHtml, kind: 'payment_received', tenantId: tenant.id });
      }
    }
  }

  return new Response('ok', { status: 200 });
}

async function handleLogin(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'Invalid request body' }, 400);
  }
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  if (!email || !password) {
    return json({ ok: false, error: 'Email and password are required' }, 400);
  }

  const user = await env.DB.prepare('SELECT * FROM users WHERE lower(email) = ?').bind(email).first();
  if (!user) {
    return json({ ok: false, error: 'Invalid email or password' }, 401);
  }

  const computedHash = await hashPassword(password, user.salt);
  if (computedHash !== user.password_hash) {
    return json({ ok: false, error: 'Invalid email or password' }, 401);
  }

  if (!user.email_verified) {
    return json({ ok: false, error: 'Please verify your email before logging in. Check your inbox for the verification link.' }, 403);
  }
  if (user.status === 'pending_approval') {
    return json({ ok: false, error: "Your account is pending approval from your company's admin." }, 403);
  }
  if (user.status === 'rejected') {
    return json({ ok: false, error: 'Your access request was declined. Contact your company admin.' }, 403);
  }

  const tenant = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(user.tenant_id).first();
  if (tenant && user.role === 'admin' && (tenant.status === 'verified' || tenant.status === 'payment_pending')) {
    const plan = tenant.recommended_plan || 'starter';
    const link = STRIPE_LINKS[plan];
    if (link) {
      const paymentUrl = link + '?prefilled_email=' + encodeURIComponent(user.email) + '&client_reference_id=' + tenant.id;
      return json({ ok: false, error: 'Your company account is verified — finish payment to activate it.', redirect: paymentUrl }, 403);
    }
    return json({ ok: false, error: 'Your plan requires a custom quote. Our team will reach out shortly, or contact hndrx@claims-collection.net.' }, 403);
  }
  if (tenant && tenant.status !== 'active' && user.role !== 'admin') {
    return json({ ok: false, error: "Your company's account setup is not finished yet. Please contact your admin." }, 403);
  }

  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').bind(token, user.id, expiresAt).run();

  const cookie = SESSION_COOKIE + '=' + token + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + SESSION_TTL_SECONDS;
  return new Response(JSON.stringify({ ok: true, redirect: '/dashboard' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie, 'Cache-Control': NO_STORE }
  });
}

async function handleLogout(request, env) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  }
  const cookie = SESSION_COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
  return new Response(JSON.stringify({ ok: true, redirect: '/' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie, 'Cache-Control': NO_STORE }
  });
}

async function handleDashboard(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) {
    return new Response(null, {
      status: 302,
      headers: { 'Location': new URL('/', request.url).toString() + '?login=1', 'Cache-Control': NO_STORE }
    });
  }
  const assetResponse = await env.ASSETS.fetch(new URL('/dashboard.html', request.url));
  let html = await assetResponse.text();
  const safeName = String(user.company_name || '').replace(/"/g, '&quot;');
  html = html
    .replace(/data-company-name="[^"]*"/, 'data-company-name="' + safeName + '"')
    .replace(/data-tenant-slug="[^"]*"/, 'data-tenant-slug="' + user.tenant_slug + '"');
  return injectHelpWidget(new Response(html, { headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': NO_STORE } }));
}

async function handleMe(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) {
    return json({ ok: false }, 401);
  }
  return json({
    ok: true,
    email: user.email,
    role: user.role,
    tenant: user.tenant_slug,
    companyName: user.company_name,
    tenantStatus: user.tenant_status,
    integrationStatus: user.integration_status
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/login' && request.method === 'POST') {
      return handleLogin(request, env);
    }
    if (url.pathname === '/api/logout' && request.method === 'POST') {
      return handleLogout(request, env);
    }
    if (url.pathname === '/api/me' && request.method === 'GET') {
      return handleMe(request, env);
    }
    if (url.pathname === '/api/signup' && request.method === 'POST') {
      return handleSignup(request, env);
    }
    if (url.pathname === '/api/verify-email' && request.method === 'GET') {
      return handleVerifyEmail(request, env);
    }
    if (url.pathname === '/api/pending-approvals' && request.method === 'GET') {
      return handlePendingApprovals(request, env);
    }
    if (url.pathname === '/api/approve-user' && request.method === 'POST') {
      return handleApproveUser(request, env);
    }
    if (url.pathname === '/api/reject-user' && request.method === 'POST') {
      return handleRejectUser(request, env);
    }
    if (url.pathname === '/api/support' && request.method === 'POST') {
      return handleSupportRequest(request, env);
    }
    if (url.pathname === '/api/forgot-password' && request.method === 'POST') {
      return handleForgotPassword(request, env);
    }
    if (url.pathname === '/api/reset-password' && request.method === 'POST') {
      return handleResetPassword(request, env);
    }
    if (url.pathname === '/api/demo-dashboard' && request.method === 'GET') {
      return handleDemoDashboard(request, env);
    }
    if (url.pathname === '/api/get-started' && request.method === 'POST') {
      return handleGetStarted(request, env);
    }
    if (url.pathname === '/thank-you' && request.method === 'GET') {
      return handleThankYou(request, env);
    }
    if (url.pathname === '/api/stripe-webhook' && request.method === 'POST') {
      return handleStripeWebhook(request, env);
    }
    if (url.pathname === '/dashboard') {
      return handleDashboard(request, env);
    }
    if (url.pathname === '/dashboard.html') {
      return new Response(null, {
        status: 302,
        headers: { 'Location': '/dashboard', 'Cache-Control': NO_STORE }
      });
    }

    const assetResponse = await env.ASSETS.fetch(request);
    return injectHelpWidget(assetResponse);
  }
};
