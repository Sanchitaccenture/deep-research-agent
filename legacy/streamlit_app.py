import streamlit as st

from app.agent import run_research


st.set_page_config(page_title="Deep Research Agent", layout="wide")
st.title("🔎 Deep Research Agent")

question = st.text_area(
    "Question",
    height=180,
    value="What are the main risks facing the EV battery industry in 2026?",
)

if st.button("Research") and question.strip():
    with st.spinner("Researching your question..."):
        result = run_research(question)

    st.subheader("Progress")
    for step in result.get("steps", []):
        st.write(step)

    st.subheader("Report")
    st.markdown(result.get("report", "No report generated."))
else:
    st.info("Enter a question and click Research to begin.")
